// NovelForge Content Script

(function () {
  'use strict';

  try {

    const isDSPage = window.location.hostname === 'chat.deepseek.com';

    if (!isDSPage) {
      // 非 chat.deepseek.com 页面只做 token/cookie 同步
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        /** 从网页端 localStorage 读取 token 并同步给 background */
        async function syncToken() {
          try {
            const token = localStorage.getItem('access_token');
            const refreshToken = localStorage.getItem('refresh_token');
            if (token && typeof chrome?.runtime?.sendMessage === 'function' && chrome?.runtime?.id) {
              chrome.runtime.sendMessage({ type: 'SET_TOKEN', token, refreshToken }, (res) => {
                if (res?.ok) console.log('[NF] Token synced from web app');
              });
            }
          } catch (e) {
            if (e.message?.includes('context invalidated')) {
              console.log('[NF] Extension context invalidated, skipping token sync');
            }
          }
        }
        setTimeout(syncToken, 1000);
        // 监听 token 变化（用户登录/登出时同步）
        window.addEventListener('storage', (e) => {
          if (e.key === 'access_token') setTimeout(syncToken, 500);
        });

        /** 通过 background 同步 DS cookie */
        async function syncDSCookie() {
          try {
            if (typeof chrome?.runtime?.sendMessage === 'function' && chrome?.runtime?.id) {
              chrome.runtime.sendMessage({ type: 'SYNC_DS_COOKIE' }, (res) => {
                if (res?.ok) console.log('[NF] DS cookie synced');
              });
            }
          } catch (e) {
            if (e.message?.includes('context invalidated')) {
              console.log('[NF] Extension context invalidated, skipping cookie sync');
            }
          }
        }
        setTimeout(syncDSCookie, 2000);

        // 标签页切回前台时立即触发心跳，让后端更新扩展连接状态
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) return
          try {
            if (typeof chrome?.runtime?.sendMessage === 'function' && chrome?.runtime?.id) {
              chrome.runtime.sendMessage({ type: 'HEARTBEAT_ON_VISIBLE' })
            }
          } catch (e) { /* context invalidated, skip */ }
        })

        // ====== 直连通道：前端页面 ↔ 扩展 ↔ DS 页面 ======
        // 监听来自 Vue 组件的直连请求
        window.addEventListener('message', (event) => {
          // 已有的同步请求
          if (event.data?.type === 'NF_SYNC_COOKIE_REQUEST') {
            try {
              if (typeof chrome?.runtime?.sendMessage === 'function' && chrome?.runtime?.id) {
                chrome.runtime.sendMessage({ type: 'SYNC_DS_COOKIE' }, (res) => {
                  window.postMessage({ type: 'NF_SYNC_COOKIE_RESULT', ok: res?.ok, length: res?.length, error: res?.error }, '*');
                });
              } else {
                window.postMessage({ type: 'NF_SYNC_COOKIE_RESULT', ok: false, error: '扩展不可用' }, '*');
              }
            } catch (e) {
              window.postMessage({ type: 'NF_SYNC_COOKIE_RESULT', ok: false, error: '扩展上下文已失效，请刷新页面' }, '*');
            }
            return
          }
          if (event.data?.type === 'NF_CHECK_DS_STATUS') {
            try {
              const respond = (data) => {
                window.postMessage({ type: 'NF_DS_STATUS_RESULT', extInstalled: true, ...data }, '*');
              };
              if (typeof chrome?.runtime?.sendMessage === 'function' && chrome?.runtime?.id) {
                chrome.runtime.sendMessage({ type: 'GET_DS_STATUS' }, (res) => {
                  if (chrome.runtime.lastError) {
                    respond({ sseConnected: false, dsTabOpen: false, extError: chrome.runtime.lastError.message });
                    return;
                  }
                  respond(res);
                });
              } else {
                respond({ sseConnected: false, dsTabOpen: false, extError: '扩展上下文不可用' });
              }
            } catch (e) {
              window.postMessage({ type: 'NF_DS_STATUS_RESULT', extInstalled: true, sseConnected: false, dsTabOpen: false, extError: e.message }, '*');
            }
            return
          }

          // 直连：前端发送聊天消息
          if (event.data?.type === 'NF_DIRECT_CHAT_SEND') {
            const { content, projectId, includeContext, temperature } = event.data
            console.log('[NF_DIRECT] Sending chat via extension bridge, content_len=' + (content?.length || 0))
            try {
              chrome.runtime.sendMessage({
                type: 'DIRECT_CHAT_SEND',
                content,
                projectId,
                includeContext,
                temperature
              }, (res) => {
                if (chrome.runtime.lastError) {
                  window.postMessage({ type: 'NF_DIRECT_ACK', ok: false, error: chrome.runtime.lastError.message }, '*')
                  return
                }
                window.postMessage({ type: 'NF_DIRECT_ACK', ok: res?.ok, error: res?.error }, '*')
              })
            } catch (e) {
              window.postMessage({ type: 'NF_DIRECT_ACK', ok: false, error: e.message }, '*')
            }
            return
          }

          // 直连：前端发送生成设定消息
          if (event.data?.type === 'NF_DIRECT_GEN_SEND') {
            const { messages, projectId, includeContext, temperature, isContinue } = event.data
            console.log('[NF_DIRECT] Sending gen via extension bridge')
            try {
              chrome.runtime.sendMessage({
                type: 'DIRECT_GEN_SEND',
                messages,
                projectId,
                includeContext,
                temperature,
                isContinue
              }, (res) => {
                if (chrome.runtime.lastError) {
                  window.postMessage({ type: 'NF_DIRECT_ACK', ok: false, error: chrome.runtime.lastError.message }, '*')
                  return
                }
                window.postMessage({ type: 'NF_DIRECT_ACK', ok: res?.ok, error: res?.error }, '*')
              })
            } catch (e) {
              window.postMessage({ type: 'NF_DIRECT_ACK', ok: false, error: e.message }, '*')
            }
            return
          }
        })

        // 监听 background 转发的 DS 输出（直连通道下行）
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          if (msg.type === 'DIRECT_CHAT_CHUNK') {
            console.log('[NF_DIRECT↓] Received CHUNK from bg, content_len=' + (msg.content?.length || 0))
            window.postMessage({ type: 'NF_DIRECT_CHUNK', content: msg.content }, '*')
            sendResponse({ ok: true })
            return true
          }
          if (msg.type === 'DIRECT_CHAT_DONE') {
            console.log('[NF_DIRECT↓] Received DONE from bg')
            window.postMessage({ type: 'NF_DIRECT_DONE' }, '*')
            sendResponse({ ok: true })
            return true
          }
          if (msg.type === 'DIRECT_CHAT_STATE') {
            console.log('[NF_DIRECT↓] Received STATE from bg: ' + msg.state)
            window.postMessage({ type: 'NF_DIRECT_STATE', state: msg.state }, '*')
            sendResponse({ ok: true })
            return true
          }
          if (msg.type === 'DIRECT_CHAT_ERROR') {
            console.log('[NF_DIRECT↓] Received ERROR from bg: ' + msg.error)
            window.postMessage({ type: 'NF_DIRECT_ERROR', error: msg.error }, '*')
            sendResponse({ ok: true })
            return true
          }
        })

        console.log('[NF_DIRECT] Direct bridge initialized on web app page')
      }
      return;
    }

    // 测试音频：220Hz 低音蜂鸣，验证后台标签页是否继续播放
    try {
      const sr = 44100, dur = 3, freq = 440
      const len = sr * dur
      const buf = new ArrayBuffer(44 + len * 2)
      const v = new DataView(buf)
      const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
      w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE')
      w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
      v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true)
      v.setUint16(32, 2, true); v.setUint16(34, 16, true)
      w(36, 'data'); v.setUint32(40, len * 2, true)
      for (let i = 0; i < len; i++) {
        const t = i / sr
        const s = Math.sin(2 * Math.PI * freq * t) * 0.002
        v.setInt16(44 + i * 2, s * 32767, true)
      }
      const audio = document.createElement('audio')
      audio.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
      audio.loop = true
      audio.volume = 0.5
      audio.setAttribute('playsinline', '')
      document.body.appendChild(audio)
      function playAudio() {
        audio.play().then(() => {
          console.log('[NF] Audio PLAYING')
        }).catch(e => {
          console.warn('[NF] Audio play failed:', e.message)
          // 浏览器暂停了音频，下次用户交互时恢复
          const resume = () => { audio.play().catch(() => { }); document.removeEventListener('click', resume); document.removeEventListener('keydown', resume) }
          document.addEventListener('click', resume, { once: true })
          document.addEventListener('keydown', resume, { once: true })
        })
      }
      // 提示用户点击页面以激活后台保活
      const tip = document.createElement('div')
      tip.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(90deg,#1a1a2e,#16213e);color:#00d4ff;padding:10px 20px;text-align:center;font-size:13px;font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;transition:opacity 0.3s;'
      tip.innerHTML = 'NovelForge 扩展已就绪 — 请<b>点击此页面任意位置</b>激活后台保活（点击后自动隐藏）'
      document.body.appendChild(tip)
      function removeTip() {
        tip.style.opacity = '0'
        setTimeout(() => tip.remove(), 300)
        playAudio()
      }
      tip.addEventListener('click', removeTip)
      for (const evt of ['click', 'keydown']) {
        document.addEventListener(evt, () => { playAudio(); if (tip.parentNode) removeTip() }, { once: true, capture: true })
      }
    } catch (e) {
      console.warn('[NF] Audio failed:', e.message)
    }

    const fab = document.createElement('div');
    fab.id = 'nf-fab';
    fab.innerHTML = 'NF';
    fab.title = 'NovelForge AI 助手';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'nf-panel';
    document.body.appendChild(panel);

    const modal = document.createElement('div');
    modal.id = 'nf-ds-modal';
    modal.innerHTML = `
    <div class="nf-modal-content">
      <div class="nf-modal-header">
        <h3 id="nf-modal-title">DeepSeek 完整回复</h3>
        <span class="nf-x" onclick="document.getElementById('nf-ds-modal').classList.remove('active')">&times;</span>
      </div>
      <div class="nf-modal-body" id="nf-modal-body"></div>
      <div class="nf-modal-footer">
        <button class="nf-btn-modal" id="nf-modal-copy">复制全文</button>
        <button class="nf-btn-modal nf-btn-modal-primary" id="nf-modal-import">导入章节</button>
      </div>
    </div>
  `;
    document.body.appendChild(modal);

    let capturedDsContent = '';
    let dsObserver = null;
    let dsPollInterval = null;

    let projectId = '';
    let projects = [];
    let currentChapterId = '';
    let currentChapterTitle = '';
    let projectData = null;
    let freeModeActive = false;

    function getUrlParams() {
      const params = {};
      const search = window.location.search.substring(1);
      search.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
      return params;
    }

    function initOnLoad() {
      const params = getUrlParams();
      if (params.nf_project) {
        projectId = params.nf_project;
        currentChapterId = params.nf_chapter || '';
        currentChapterTitle = params.nf_title || '';
        freeModeActive = true;
        chrome.storage.local.set({ nf_pid: projectId, nf_chapter_id: currentChapterId, nf_chapter_title: currentChapterTitle });
      }
    }

    initOnLoad();

    fab.onclick = () => {
      const isHidden = panel.style.display === 'none' || panel.style.display === '';
      panel.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) initPanel();
    };

    async function initPanel() {
      // 先尝试从网页版同步 token（如果失败也没关系，可能有缓存的）
      try {
        if (typeof chrome?.runtime?.sendMessage === 'function' && chrome?.runtime?.id) {
          chrome.runtime.sendMessage({ type: 'SYNC_NF_TOKEN' });
        }
      } catch (e) { /* context invalidated, skip */ }

      const tokenRes = await msg('GET_TOKEN');

      if (!tokenRes.token) {
        panel.innerHTML = `
        <div class="nf-hdr"><b>NovelForge</b><span class="nf-x" onclick="this.closest('#nf-panel').style.display='none'">&times;</span></div>
        <div class="nf-content" style="text-align:center;padding:20px">
          <div style="font-size:16px;margin-bottom:12px">🔑 NovelForge</div>
          <div class="nf-warn">请先打开网页版并登录</div>
          <div class="nf-hint" style="margin-top:8px;font-size:12px">打开 localhost:5173/5174 登录后刷新本页面</div>
          <button class="nf-btn nf-btn-main" id="nf-retry-btn" style="margin-top:12px">刷新</button>
        </div>
      `;
        document.getElementById('nf-retry-btn').onclick = () => location.reload();
        return;
      }

      const projRes = await msg('GET_PROJECTS');

      if (!projRes.ok) {
        panel.innerHTML = `
        <div class="nf-hdr"><b>NovelForge</b><span class="nf-x" onclick="this.closest('#nf-panel').style.display='none'">&times;</span></div>
        <div class="nf-content" style="text-align:center;padding:20px">
          <div class="nf-warn">${projRes.error || '登录失效'}</div>
          <div class="nf-hint" style="margin-top:8px;font-size:12px">请刷新网页版后重试</div>
          <button class="nf-btn nf-btn-main" id="nf-retry-btn" style="margin-top:12px">重试</button>
        </div>
      `;
        document.getElementById('nf-retry-btn').onclick = () => location.reload();
        return;
      }

      projects = projRes.data?.items || [];

      panel.innerHTML = `
      <div class="nf-hdr"><b>NovelForge</b><span class="nf-x" onclick="this.closest('#nf-panel').style.display='none'">&times;</span></div>
      <div class="nf-tabs">
        <button class="nf-tab ${freeModeActive ? '' : 'active'}" id="nf-tab-gen">生成设定</button>
        <button class="nf-tab ${freeModeActive ? 'active' : ''}" id="nf-tab-novel">小说辅助</button>
        <button class="nf-tab" id="nf-tab-picker">元素选择</button>
        <button class="nf-tab" id="nf-tab-chat">聊天记录</button>
      </div>
      <div class="nf-content">
        <div id="nf-gen-panel">
          <label class="nf-lbl">项目</label>
          <select class="nf-inp" id="nf-sel">
            <option value="">-- 选择项目 --</option>
            ${projects.map(p => `<option value="${p.id}">${p.title}</option>`).join('')}
          </select>
          ${projects.length === 0 ? '<div class="nf-warn">没有项目，请先在网页端创建项目</div>' : ''}
          <button class="nf-btn nf-btn-secondary" id="nf-export-btn" style="margin-top:8px;display:none">导出项目为TXT</button>

          <hr class="nf-hr" />

          <label class="nf-lbl">粘贴 DeepSeek 回复</label>
          <textarea class="nf-inp nf-ta" id="nf-ds-text" placeholder="复制 DeepSeek 的回复粘贴到这里..."></textarea>
          <button class="nf-btn nf-btn-main" id="nf-go">解析并导入</button>
          <div class="nf-msg" id="nf-result"></div>

          <hr class="nf-hr" />

          <label class="nf-lbl">生成类型</label>
          <select class="nf-inp" id="nf-gen-type">
            <option value="world">世界观设定</option>
            <option value="characters">角色设定</option>
            <option value="relationships">角色关系</option>
            <option value="all">完整生成</option>
          </select>

          <div id="nf-world-types" style="margin-top:8px">
            <label class="nf-lbl">选择世界观模块</label>
            <div class="nf-checkboxes" style="margin-bottom:4px">
              <label><input type="checkbox" id="nf-sel-all-modules" checked /> 全选</label>
            </div>
            <div class="nf-checkboxes">
              <label><input type="checkbox" value="era" class="nf-module-check" checked /> 时代背景</label>
              <label><input type="checkbox" value="geography" class="nf-module-check" checked /> 地理环境</label>
              <label><input type="checkbox" value="magic" class="nf-module-check" checked /> 超凡体系</label>
              <label><input type="checkbox" value="politics" class="nf-module-check" checked /> 政治体系</label>
              <label><input type="checkbox" value="race" class="nf-module-check" /> 种族设定</label>
              <label><input type="checkbox" value="religion" class="nf-module-check" /> 宗教信仰</label>
              <label><input type="checkbox" value="history" class="nf-module-check" /> 历史事件</label>
              <label><input type="checkbox" value="culture" class="nf-module-check" /> 社会文化</label>
              <label><input type="checkbox" value="economy" class="nf-module-check" /> 经济体系</label>
            </div>
          </div>

          <hr class="nf-hr" />

          <label class="nf-lbl">提问模板</label>
          <textarea class="nf-inp nf-ta-sm" id="nf-ask" placeholder="例如：生成一个修仙世界的完整设定"></textarea>
          <button class="nf-btn" id="nf-copy">复制提问（含JSON格式）</button>
        </div>

        <div id="nf-novel-panel" style="display:none">
          <div class="nf-free-badge">小说辅助</div>

          <label class="nf-lbl">项目</label>
          <select class="nf-inp" id="nf-novel-sel">
            <option value="">-- 选择项目 --</option>
            ${projects.map(p => `<option value="${p.id}">${p.title}</option>`).join('')}
          </select>

          <label class="nf-lbl">章节</label>
          <select class="nf-inp" id="nf-chapter-sel">
            <option value="">-- 先选择项目 --</option>
          </select>
          <div id="nf-chapter-hint" class="nf-hint" style="margin-top:4px"></div>

          <hr class="nf-hr" />

          <label class="nf-lbl">上下文（决定AI看到哪些背景信息）</label>
          <div class="nf-checkboxes" style="margin-bottom:4px">
            <label><input type="checkbox" id="nf-sel-all-ctx" checked /> 全选</label>
          </div>
          <div class="nf-checkboxes">
            <label><input type="checkbox" id="nf-include-world" checked /> 世界观设定</label>
            <label><input type="checkbox" id="nf-include-rules" checked /> 硬规则</label>
            <label><input type="checkbox" id="nf-include-chars" checked /> 角色信息</label>
            <label><input type="checkbox" id="nf-include-rels" checked /> 角色关系</label>
            <label><input type="checkbox" id="nf-include-prev-chapter" checked /> 前章剧情</label>
          </div>

          <hr class="nf-hr" />

          <label class="nf-lbl">你的写作要求</label>
          <textarea class="nf-inp nf-ta" id="nf-user-request" placeholder="描述当前章节的写作方向或要求..."></textarea>

          <button class="nf-btn nf-btn-main" id="nf-gen-chapter-btn" style="margin-top:10px">生成章节提示词</button>

          <div id="nf-chapter-result" style="margin-top:10px"></div>

          <div id="nf-ds-capture-area" class="nf-ds-capture" style="display:none">
            <div class="nf-ds-capture-header">
              <span><span id="nf-ds-badge" class="nf-badge-new" style="display:none"></span>DeepSeek 回复</span>
              <button class="nf-btn" id="nf-view-all-btn" style="padding:2px 8px;font-size:10px">查看全部</button>
            </div>
            <div id="nf-ds-preview" class="nf-ds-preview"></div>
            <div class="nf-ds-capture-btns">
              <button class="nf-btn" id="nf-import-chapter-btn" style="display:none">导入本章</button>
            </div>
          </div>
        </div>

        <div id="nf-picker-panel" style="display:none">
          <div class="nf-picker-header">
            <button class="nf-btn nf-btn-main" id="nf-get-all-btn">📋 一键获取全部</button>
            <button class="nf-btn" id="nf-export-txt-btn">� 导出TXT</button>
          </div>
          <div class="nf-picker-status" id="nf-picker-status">点击"一键获取全部"扫描页面所有元素</div>
          <div class="nf-picker-result" id="nf-picker-result"></div>
        </div>

        <div id="nf-chat-panel" style="display:none">
          <div class="nf-chat-header">
            <button class="nf-btn nf-btn-main" id="nf-capture-chat-btn">📥 捕获聊天记录</button>
            <button class="nf-btn" id="nf-export-chat-btn">💾 导出为TXT</button>
            <button class="nf-btn" id="nf-clear-chat-btn">🗑 清除缓存</button>
          </div>
          <div class="nf-chat-status" id="nf-chat-status">点击"捕获聊天记录"获取当前对话内容</div>
          <div class="nf-chat-result" id="nf-chat-result"></div>
        </div>
      </div>
    `;

      // Tab switching
      document.getElementById('nf-tab-gen').onclick = () => switchTab('gen');
      document.getElementById('nf-tab-novel').onclick = () => switchTab('novel');
      document.getElementById('nf-tab-picker').onclick = () => switchTab('picker');

      function switchTab(tab) {
        document.getElementById('nf-tab-gen').classList.toggle('active', tab === 'gen');
        document.getElementById('nf-tab-novel').classList.toggle('active', tab === 'novel');
        document.getElementById('nf-tab-picker').classList.toggle('active', tab === 'picker');
        document.getElementById('nf-tab-chat').classList.toggle('active', tab === 'chat');
        document.getElementById('nf-gen-panel').style.display = tab === 'gen' ? 'block' : 'none';
        document.getElementById('nf-novel-panel').style.display = tab === 'novel' ? 'block' : 'none';
        document.getElementById('nf-picker-panel').style.display = tab === 'picker' ? 'block' : 'none';
        document.getElementById('nf-chat-panel').style.display = tab === 'chat' ? 'block' : 'none';
        if (tab === 'novel' && projectId) {
          const novelSel = document.getElementById('nf-novel-sel');
          if (novelSel?.value !== projectId) {
            novelSel.value = projectId;
            novelSel.dispatchEvent(new Event('change'));
          }
        }
        savePrefs();
      }

      // Preference storage
      function savePrefs() {
        const prefs = {
          activeTab: document.getElementById('nf-tab-gen').classList.contains('active') ? 'gen' : 'novel',
          genType: document.getElementById('nf-gen-type')?.value || 'world',
          moduleChecks: {},
          contextChecks: {}
        };
        document.querySelectorAll('.nf-module-check').forEach(el => { prefs.moduleChecks[el.value] = el.checked; });
        prefs.contextChecks.world = document.getElementById('nf-include-world')?.checked ?? true;
        prefs.contextChecks.rules = document.getElementById('nf-include-rules')?.checked ?? true;
        prefs.contextChecks.chars = document.getElementById('nf-include-chars')?.checked ?? true;
        prefs.contextChecks.rels = document.getElementById('nf-include-rels')?.checked ?? true;
        prefs.contextChecks.prevChapter = document.getElementById('nf-include-prev-chapter')?.checked ?? true;
        prefs.userRequest = document.getElementById('nf-user-request')?.value || '';
        chrome.storage.local.set({ nf_prefs: prefs });
      }

      function loadPrefs(prefs) {
        if (!prefs) return;
        if (prefs.genType) {
          const genType = document.getElementById('nf-gen-type');
          if (genType) {
            genType.value = prefs.genType;
            genType.dispatchEvent(new Event('change'));
          }
        }
        if (prefs.moduleChecks) {
          document.querySelectorAll('.nf-module-check').forEach(el => {
            if (prefs.moduleChecks[el.value] !== undefined) el.checked = prefs.moduleChecks[el.value];
          });
        }
        if (prefs.contextChecks) {
          const ctxMap = { world: 'nf-include-world', rules: 'nf-include-rules', chars: 'nf-include-chars', rels: 'nf-include-rels', prevChapter: 'nf-include-prev-chapter' };
          for (const [k, id] of Object.entries(ctxMap)) {
            const el = document.getElementById(id);
            if (el && prefs.contextChecks[k] !== undefined) el.checked = prefs.contextChecks[k];
          }
        }
        if (prefs.userRequest !== undefined) {
          const reqEl = document.getElementById('nf-user-request');
          if (reqEl) reqEl.value = prefs.userRequest;
        }
        if (prefs.activeTab) {
          switchTab(prefs.activeTab);
        }
        savePrefs();
      }

      document.getElementById('nf-sel').onchange = async (e) => {
        projectId = e.target.value;
        chrome.storage.local.set({ nf_pid: projectId });
        savePrefs();
        if (projectId) {
          const exportBtn = document.getElementById('nf-export-btn');
          if (exportBtn) exportBtn.style.display = 'inline-block';
        }
      };

      document.getElementById('nf-gen-type').onchange = (e) => {
        const worldTypesDiv = document.getElementById('nf-world-types');
        worldTypesDiv.style.display = (e.target.value === 'world' || e.target.value === 'all') ? 'block' : 'none';
        savePrefs();
      };

      document.getElementById('nf-go').onclick = doImport;
      document.getElementById('nf-copy').onclick = doCopyAsk;
      document.getElementById('nf-export-btn').onclick = doExportTxt;

      // Novel panel handlers
      document.getElementById('nf-novel-sel').onchange = async (e) => {
        const novelPid = e.target.value;
        projectId = novelPid;
        chrome.storage.local.set({ nf_pid: novelPid });
        savePrefs();
        currentChapterId = '';
        if (novelPid) {
          const dataRes = await msg('GET_ALL_PROJECT_DATA', { projectId: novelPid, chapterId: '' });
          if (dataRes.ok) {
            const chapters = Array.isArray(dataRes.data?.chapters) ? dataRes.data.chapters
              : Array.isArray(dataRes.data?.chapters?.items) ? dataRes.data.chapters.items : [];
            const sorted = [...chapters].sort((a, b) => (a.order || 0) - (b.order || 0));
            const opts = sorted.map((c, i) => {
              const num = i + 1;
              const label = c.title || `第${num}章`;
              return `<option value="${c.id}">${label}</option>`;
            }).join('');
            document.getElementById('nf-chapter-sel').innerHTML = opts || '<option value="">-- 无章节 --</option>';
            if (sorted.length > 0) {
              currentChapterId = sorted[0].id;
              updateChapterHint();
            } else {
              document.getElementById('nf-chapter-hint').textContent = '';
            }
          }
        } else {
          document.getElementById('nf-chapter-sel').innerHTML = '<option value="">-- 先选择项目 --</option>';
          document.getElementById('nf-chapter-hint').textContent = '';
        }
      };

      document.getElementById('nf-chapter-sel').onchange = async (e) => {
        currentChapterId = e.target.value;
        chrome.storage.local.set({ nf_chapter_id: currentChapterId });
        updateChapterHint();
        savePrefs();
      };

      document.getElementById('nf-gen-chapter-btn').onclick = doGenChapterPrompt;

      // Context checkbox handlers
      ['nf-include-world', 'nf-include-rules', 'nf-include-chars', 'nf-include-rels', 'nf-include-prev-chapter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', savePrefs);
      });

      // Module checkboxes
      document.querySelectorAll('.nf-module-check').forEach(el => el.addEventListener('change', savePrefs));

      // 全选 modules
      const selAllModules = document.getElementById('nf-sel-all-modules');
      if (selAllModules) {
        selAllModules.addEventListener('change', (e) => {
          document.querySelectorAll('.nf-module-check').forEach(el => { el.checked = e.target.checked; });
          savePrefs();
        });
      }

      // 全选 context
      const selAllCtx = document.getElementById('nf-sel-all-ctx');
      if (selAllCtx) {
        selAllCtx.addEventListener('change', (e) => {
          ['nf-include-world', 'nf-include-rules', 'nf-include-chars', 'nf-include-rels', 'nf-include-prev-chapter'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = e.target.checked;
          });
          savePrefs();
        });
      }

      // User request textarea
      const userReqEl = document.getElementById('nf-user-request');
      if (userReqEl) userReqEl.addEventListener('input', savePrefs);

      // DS capture handlers
      const viewAllBtn = document.getElementById('nf-view-all-btn');
      if (viewAllBtn) viewAllBtn.addEventListener('click', showDsModal);

      const importChapterBtn = document.getElementById('nf-import-chapter-btn');
      if (importChapterBtn) importChapterBtn.addEventListener('click', importChapterFromDs);

      const modalCopyBtn = document.getElementById('nf-modal-copy');
      if (modalCopyBtn) modalCopyBtn.addEventListener('click', () => {
        const body = document.getElementById('nf-modal-body');
        const text = body?.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
          const btn = document.getElementById('nf-modal-copy');
          if (btn) { btn.textContent = '已复制!'; setTimeout(() => { if (btn) btn.textContent = '复制全文'; }, 1500); }
        });
      });

      const modalImportBtn = document.getElementById('nf-modal-import');
      if (modalImportBtn) modalImportBtn.addEventListener('click', () => {
        const body = document.getElementById('nf-modal-body');
        const text = body?.textContent || '';
        document.getElementById('nf-ds-modal').classList.remove('active');
        importChapterFromDsText(text);
      });

      let scannedElements = [];

      function copyElementHtml(index) {
        const el = scannedElements[index];
        if (!el) return;
        const text = el.html || el.outerHTML || '';
        navigator.clipboard.writeText(text).then(() => {
          const btn = document.querySelector(`[data-copy-btn="${index}"]`);
          if (btn) {
            btn.textContent = '已复制!';
            setTimeout(() => { btn.textContent = '复制'; }, 1500);
          }
        });
      }

      function exportAllToTxt() {
        if (scannedElements.length === 0) {
          alert('请先点击"一键获取全部"扫描页面元素');
          return;
        }
        let txt = 'DeepSeek 页面元素清单\n';
        txt += '生成时间: ' + new Date().toLocaleString() + '\n';
        txt += '总计: ' + scannedElements.length + ' 个元素\n';
        txt += '='.repeat(50) + '\n\n';

        scannedElements.forEach((el, i) => {
          txt += `【${i + 1}】 <${el.tagName}>\n`;
          if (el.id) txt += '  ID: ' + el.id + '\n';
          if (el.className) txt += '  CLASS: ' + el.className + '\n';
          if (el.text) txt += '  TEXT: ' + el.text.substring(0, 200) + '\n';
          txt += '  HTML:\n' + (el.html || el.outerHTML || '').split('\n').map(l => '    ' + l).join('\n') + '\n';
          txt += '-'.repeat(30) + '\n\n';
        });

        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ds_elements_' + Date.now() + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      function getAllPageElements() {
        const status = document.getElementById('nf-picker-status');
        const container = document.getElementById('nf-picker-result');
        if (!container) return;

        status.textContent = '正在捕获最后一条 DS 回复的完整结构...';
        container.innerHTML = '<div style="padding:10px;text-align:center;color:#666">扫描中...</div>';

        setTimeout(() => {
          const ASSISTANT_SEL = '.ds-markdown.ds-assistant-message-main-content';
          const allResponses = document.querySelectorAll(ASSISTANT_SEL);
          const lastResponse = allResponses[allResponses.length - 1];

          if (!lastResponse) {
            status.textContent = '未找到 DS 回复元素';
            container.innerHTML = '<div style="padding:20px;text-align:center;color:#dc2626">未找到 DeepSeek 回复内容。<br>请先发送一条消息等待回复完成。</div>';
            return;
          }

          // 向上查找包含操作栏的完整消息容器
          // 操作栏（复制、重试、继续生成等）在 .ds-message 的外层
          let msgContainer = lastResponse.closest('.ds-message') || lastResponse;
          // 操作栏通常是 .ds-message 的兄弟元素，需要到父级
          let parent = msgContainer.parentElement;
          if (parent && parent.querySelector('button, [role="button"]')) {
            msgContainer = parent;
          } else if (parent?.parentElement) {
            // 再往上一层
            if (parent.parentElement.querySelector('button, [role="button"]')) {
              msgContainer = parent.parentElement;
            }
          }

          const targetEl = msgContainer;

          // 递归构建 DOM 树
          function buildDomTree(el, depth = 0) {
            if (depth > 15) return ''
            const tag = el.tagName?.toLowerCase() || '?'
            const cls = el.className && typeof el.className === 'string' ? el.className.trim() : ''
            const id = el.id || ''
            const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
              ? (el.textContent || '').trim().substring(0, 200) : ''

            let attr = ''
            if (id) attr += ` id="${id}"`
            if (cls) attr += ` class="${cls.substring(0, 120)}"`
            if (el.getAttribute?.('role')) attr += ` role="${el.getAttribute('role')}"`
            if (el.getAttribute?.('aria-label')) attr += ` aria-label="${el.getAttribute('aria-label')}"`
            if (el.getAttribute?.('aria-disabled')) attr += ` aria-disabled="${el.getAttribute('aria-disabled')}"`
            if (el.getAttribute?.('data-virtual-list-item-key')) attr += ` data-key="${el.getAttribute('data-virtual-list-item-key')}"`

            const indent = '  '.repeat(depth)
            let line = `${indent}<${tag}${attr}>`
            if (text) line += ` ${text}`
            line += `</${tag}>`

            let childLines = ''
            for (const child of el.children) {
              childLines += buildDomTree(child, depth + 1)
            }

            return line + '\n' + childLines
          }

          const treeOutput = buildDomTree(targetEl)

          const allEls = targetEl.querySelectorAll('*');
          const codeBlocks = targetEl.querySelectorAll('.md-code-block, [class*="code-block"], pre, code');
          const buttons = targetEl.querySelectorAll('button, [role="button"]');
          const actionButtons = [];
          buttons.forEach(btn => {
            const txt = (btn.textContent || '').trim();
            if (txt && txt.length < 20) actionButtons.push(txt);
          });

          // 检测是否有"继续生成"按钮
          let hasContinueBtn = false;
          buttons.forEach(btn => {
            const txt = (btn.textContent || '').trim();
            if (txt.includes('继续') || txt.includes('Continue')) hasContinueBtn = true;
          });

          function exportTree() {
            const fullOutput = [
              '=== DeepSeek 最后回复完整 DOM 结构 ===',
              '时间: ' + new Date().toLocaleString(),
              '总元素: ' + allEls.length,
              '代码块: ' + codeBlocks.length,
              '按钮: ' + buttons.length,
              '操作栏按钮: ' + actionButtons.join(', '),
              '继续生成按钮: ' + (hasContinueBtn ? '是' : '否'),
              'outerHTML 长度: ' + targetEl.outerHTML.length,
              '',
              '--- DOM 树 ---',
              treeOutput,
              '',
              '--- 完整 outerHTML ---',
              targetEl.outerHTML
            ].join('\n')

            const blob = new Blob([fullOutput], { type: 'text/plain;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'ds_response_dom_' + Date.now() + '.txt'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          }

          container.innerHTML = `
            <div style="margin-bottom:10px;padding:8px;background:#f0f7ff;border-radius:6px;font-size:11px;color:#333">
              <b>最后一条 DS 回复（含操作栏）</b><br>
              元素: ${allEls.length} | 代码块: ${codeBlocks.length} | 按钮: ${buttons.length}<br>
              操作栏: ${actionButtons.join(' | ')}<br>
              继续生成: ${hasContinueBtn ? '✅ 存在' : '❌ 不存在'}<br>
              outerHTML: ${targetEl.outerHTML.length} 字符
              <div style="margin-top:6px;display:flex;gap:6px">
                <button class="nf-btn nf-btn-main" id="nf-export-tree-btn" style="padding:3px 10px;font-size:11px">📥 导出完整 DOM</button>
                <button class="nf-btn" id="nf-copy-tree-btn" style="padding:3px 10px;font-size:11px">📋 复制 DOM 树</button>
              </div>
            </div>
            <pre style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;font-size:11px;line-height:1.5;overflow:auto;max-height:600px;white-space:pre;margin:0">${escapeHtml(treeOutput)}</pre>
          `;

          document.getElementById('nf-export-tree-btn')?.addEventListener('click', exportTree)
          document.getElementById('nf-copy-tree-btn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(treeOutput).then(() => {
              const btn = document.getElementById('nf-copy-tree-btn')
              if (btn) { btn.textContent = '✅ 已复制!'; setTimeout(() => { btn.textContent = '📋 复制 DOM 树' }, 1500) }
            })
          })

          status.textContent = `捕获完成！${allEls.length} 元素，${buttons.length} 按钮，继续生成: ${hasContinueBtn ? '是' : '否'}`
        }, 200)
      }

      const getAllBtn = document.getElementById('nf-get-all-btn');
      if (getAllBtn) getAllBtn.addEventListener('click', getAllPageElements);

      const exportTxtBtn = document.getElementById('nf-export-txt-btn');
      if (exportTxtBtn) exportTxtBtn.addEventListener('click', exportAllToTxt);

      let capturedChats = [];

      function saveChatsToStorage() {
        if (!chrome?.storage?.local) return;
        chrome.storage.local.set({ nf_captured_chats: capturedChats, nf_chats_timestamp: Date.now() });
      }

      function loadChatsFromStorage() {
        return new Promise((resolve) => {
          if (!chrome?.storage?.local) {
            resolve([]);
            return;
          }
          chrome.storage.local.get(['nf_captured_chats'], (result) => {
            resolve(result.nf_captured_chats || []);
          });
        });
      }

      function renderCapturedChats() {
        const container = document.getElementById('nf-chat-result');
        const status = document.getElementById('nf-chat-status');
        if (!container) return;

        if (capturedChats.length === 0) {
          container.innerHTML = `
            <div class="nf-chat-empty">
              <p>暂无缓存的聊天记录</p>
              <p style="font-size:10px;color:#888;margin-top:8px">点击"捕获聊天记录"开始获取</p>
            </div>
          `;
          status.textContent = '点击"捕获聊天记录"获取当前对话内容';
          return;
        }

        container.innerHTML = capturedChats.map((chat, i) => `
          <div class="nf-chat-item" data-chat-index="${i}">
            <h4>#${i + 1} ${chat.role === 'user' ? '用户' : 'DeepSeek'}
              <button class="nf-btn nf-btn-small nf-view-single" data-index="${i}" style="float:right;margin-left:5px">👁 查看</button>
              <button class="nf-btn nf-btn-small nf-export-single" data-index="${i}" style="float:right;margin-left:5px">💾 导出</button>
              <button class="nf-btn nf-btn-small nf-copy-single" data-index="${i}" style="float:right">📋 复制</button>
            </h4>
            <div class="nf-chat-role ${chat.role}">${chat.role === 'user' ? '👤 用户' : '🤖 DeepSeek'}</div>
            ${chat.isFile ? '<div class="nf-chat-warn">⚠️ 询问内容在文件中</div>' : ''}
            ${chat.role === 'user' ? '<button class="nf-btn nf-btn-small nf-import-single" data-index="${i}" style="margin-top:4px">📥 导入本章</button>' : ''}
            <div class="nf-chat-text">${escapeHtml(chat.text.substring(0, 500))}${chat.text.length > 500 ? '...' : ''}</div>
          </div>
        `).join('');

        container.querySelectorAll('.nf-view-single').forEach(btn => {
          btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            const chat = capturedChats[index];
            if (!chat) return;
            showChatModal(chat.text, chat.role, index);
          });
        });

        container.querySelectorAll('.nf-import-single').forEach(btn => {
          btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            const chat = capturedChats[index];
            if (!chat) return;
            if (!projectId || !currentChapterId) {
              alert('请先在"小说辅助"标签页选择项目和章节');
              return;
            }
            importSingleChat(chat.text, index);
          });
        });

        container.querySelectorAll('.nf-export-single').forEach(btn => {
          btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            const chat = capturedChats[index];
            if (!chat) return;
            let txt = 'DeepSeek 聊天记录 - 单条导出\n';
            txt += '对话标题: ' + chat.title + '\n';
            txt += '角色: ' + (chat.role === 'user' ? '用户' : 'DeepSeek') + '\n';
            txt += '序号: ' + (index + 1) + '\n';
            txt += '导出时间: ' + new Date().toLocaleString() + '\n';
            txt += '='.repeat(50) + '\n\n';
            txt += chat.text + '\n';

            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const prefix = chat.role === 'user' ? 'user' : 'ds';
            a.download = 'ds_chat_' + prefix + '_' + (index + 1) + '_' + Date.now() + '.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          });
        });

        container.querySelectorAll('.nf-copy-single').forEach(btn => {
          btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            const chat = capturedChats[index];
            if (!chat) return;
            navigator.clipboard.writeText(chat.text).then(() => {
              const original = btn.textContent;
              btn.textContent = '已复制!';
              setTimeout(() => { btn.textContent = original; }, 1500);
            });
          });
        });

        status.textContent = `已加载缓存（${capturedChats.length} 条），点击"捕获聊天记录"可刷新`;
      }

      function showChatModal(text, role, index) {
        const modal = document.getElementById('nf-ds-modal');
        const body = document.getElementById('nf-modal-body');
        const titleEl = document.getElementById('nf-modal-title');
        if (modal && body) {
          body.textContent = text;
          if (titleEl) titleEl.textContent = (role === 'user' ? '用户' : 'DeepSeek') + ' 完整内容 (#' + (index + 1) + ')';
          modal.classList.add('active');
        }
      }

      async function importSingleChat(text, index) {
        if (!text) { alert('没有可导入的内容'); return; }
        if (!projectId || !currentChapterId) { alert('请先选择项目和章节'); return; }

        text = text.replace(/\\n/g, '\n');

        const json = extractJSON(text);
        let content = json ? (json.content || text) : text;
        const title = json?.title || null;

        content = content.replace(/\\n/g, '\n');
        content = formatChapterText(content);

        const res = await msg('SAVE_CHAPTER_CONTENT', {
          projectId,
          chapterId: currentChapterId,
          content: content,
          title: title
        });

        if (res.ok) {
          alert('第 ' + (index + 1) + ' 条内容已保存到章节！');
        } else {
          alert('保存失败: ' + (res.error || '未知错误'));
        }
      }

      async function captureDeepSeekChat() {
        const status = document.getElementById('nf-chat-status');
        const container = document.getElementById('nf-chat-result');
        if (!container) return;

        status.textContent = '正在捕获聊天记录（滚动加载中...）...';
        container.innerHTML = '<div style="padding:10px;text-align:center;color:#666">正在滚动加载内容...</div>';

        capturedChats = [];

        try {
          const scrollArea = document.querySelector('.ds-scroll-area, [class*="scroll-area"], [class*="messages"]');
          const originalScrollTop = scrollArea?.scrollTop || 0;

          if (scrollArea) {
            const scrollContainer = scrollArea;
            let lastHeight = 0;
            let stableCount = 0;
            const maxIterations = 80;
            let iterations = 0;

            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            await new Promise(r => setTimeout(r, 600));

            while (iterations < maxIterations) {
              iterations++;
              const currentHeight = scrollContainer.scrollHeight;

              if (currentHeight === lastHeight) {
                stableCount++;
                if (stableCount >= 3) break;
              } else {
                stableCount = 0;
                lastHeight = currentHeight;
              }

              scrollContainer.scrollTop = scrollContainer.scrollHeight;
              await new Promise(r => setTimeout(r, 300));
            }

            scrollContainer.scrollTop = 0;
            await new Promise(r => setTimeout(r, 600));

            stableCount = 0;
            lastHeight = 0;

            while (iterations < maxIterations * 2) {
              iterations++;
              const currentHeight = scrollContainer.scrollHeight;

              if (currentHeight === lastHeight) {
                stableCount++;
                if (stableCount >= 3) break;
              } else {
                stableCount = 0;
                lastHeight = currentHeight;
              }

              scrollContainer.scrollTop = 0;
              await new Promise(r => setTimeout(r, 300));
            }

            scrollContainer.scrollTop = originalScrollTop;
            status.textContent = `滚动加载完成（${iterations}次），正在捕获...`;
          }

          await new Promise(r => setTimeout(r, 800));

          const titleEl = document.querySelector('.the-header ._5a50d80, .the-header .afa34042, .the-header');
          const chatTitle = titleEl?.innerText?.trim() || '未命名对话';

          const userMessages = document.querySelectorAll('._9d8da05, [class*="user-message"], [data-role="user"] div, [class*="human"]');
          const assistantMessages = document.querySelectorAll('[class*="assistant"], [class*="ds-assistant"], .ds-markdown');

          let msgIndex = 0;
          const allMessages = [];

          const messageContainers = document.querySelectorAll('[data-virtual-list-item-key], .ds-message, [class*="message"]');

          messageContainers.forEach((container) => {
            const userContent = container.querySelector('._9d8da05, [class*="user-message"], [data-role="user"]');
            const assistantContent = container.querySelector('[class*="assistant"], [class*="ds-assistant"], .ds-markdown, [data-role="assistant"]');

            if (userContent) {
              const text = (userContent.innerText || '').trim();
              if (text && text.length > 0) {
                allMessages.push({
                  role: 'user',
                  index: msgIndex++,
                  title: chatTitle,
                  text: text,
                  isEmpty: text.length === 0,
                  isFile: text.includes('[文件]') || text.includes('.pdf') || text.includes('.doc') || text.includes('.txt')
                });
              }
            }

            if (assistantContent) {
              const text = (assistantContent.innerText || '').trim();
              if (text && text.length > 10) {
                allMessages.push({
                  role: 'assistant',
                  index: msgIndex++,
                  title: chatTitle,
                  text: text,
                  isEmpty: false,
                  isFile: false
                });
              }
            }
          });

          if (allMessages.length === 0) {
            const simpleUserMsgs = document.querySelectorAll('._9d8da05');
            simpleUserMsgs.forEach((msg) => {
              const text = (msg.innerText || '').trim();
              if (text) {
                allMessages.push({
                  role: 'user',
                  index: msgIndex++,
                  title: chatTitle,
                  text: text,
                  isEmpty: text.length === 0,
                  isFile: text.includes('[文件]') || text.includes('.pdf')
                });
              }
            });
          }

          capturedChats = allMessages;

          if (capturedChats.length === 0) {
            container.innerHTML = `
              <div class="nf-chat-empty">
                <p>未找到聊天记录</p>
                <p style="font-size:10px;color:#888;margin-top:8px">可能原因：</p>
                <ul style="text-align:left;font-size:10px;color:#888;margin-top:4px">
                  <li>页面使用了虚拟列表，内容未加载</li>
                  <li>需要向上滚动页面触发加载</li>
                  <li>当前页面不是 DeepSeek 对话页面</li>
                </ul>
              </div>
            `;
            status.textContent = '未找到聊天记录，请尝试滚动页面后再捕获';
            return;
          }

          container.innerHTML = capturedChats.map((chat, i) => `
            <div class="nf-chat-item" data-chat-index="${i}">
              <h4>#${i + 1} ${chat.role === 'user' ? '用户' : 'DeepSeek'}
                <button class="nf-btn nf-btn-small nf-export-single" data-index="${i}" style="float:right;margin-left:5px">💾 导出</button>
                <button class="nf-btn nf-btn-small nf-copy-single" data-index="${i}" style="float:right">📋 复制</button>
              </h4>
              <div class="nf-chat-role ${chat.role}">${chat.role === 'user' ? '👤 用户' : '🤖 DeepSeek'}</div>
              ${chat.isFile ? '<div class="nf-chat-warn">⚠️ 询问内容在文件中</div>' : ''}
              <div class="nf-chat-text">${escapeHtml(chat.text.substring(0, 500))}${chat.text.length > 500 ? '...' : ''}</div>
            </div>
          `).join('');

          container.querySelectorAll('.nf-export-single').forEach(btn => {
            btn.addEventListener('click', () => {
              const index = parseInt(btn.dataset.index);
              const chat = capturedChats[index];
              if (!chat) return;
              let txt = 'DeepSeek 聊天记录 - 单条导出\n';
              txt += '对话标题: ' + chat.title + '\n';
              txt += '角色: ' + (chat.role === 'user' ? '用户' : 'DeepSeek') + '\n';
              txt += '序号: ' + (index + 1) + '\n';
              txt += '导出时间: ' + new Date().toLocaleString() + '\n';
              txt += '='.repeat(50) + '\n\n';
              txt += chat.text + '\n';

              const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              const prefix = chat.role === 'user' ? 'user' : 'ds';
              a.download = 'ds_chat_' + prefix + '_' + (index + 1) + '_' + Date.now() + '.txt';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            });
          });

          container.querySelectorAll('.nf-copy-single').forEach(btn => {
            btn.addEventListener('click', () => {
              const index = parseInt(btn.dataset.index);
              const chat = capturedChats[index];
              if (!chat) return;
              navigator.clipboard.writeText(chat.text).then(() => {
                const original = btn.textContent;
                btn.textContent = '已复制!';
                setTimeout(() => { btn.textContent = original; }, 1500);
              });
            });
          });

          saveChatsToStorage();
          renderCapturedChats();

        } catch (e) {
          container.innerHTML = '<div style="padding:10px;color:#dc2626">捕获失败: ' + escapeHtml(e.message) + '</div>';
          status.textContent = '捕获失败';
        }
      }

      function exportChatToTxt() {
        if (capturedChats.length === 0) {
          alert('请先点击"捕获聊天记录"');
          return;
        }

        let txt = 'DeepSeek 聊天记录\n';
        txt += '对话标题: ' + (capturedChats[0]?.title || '未命名') + '\n';
        txt += '导出时间: ' + new Date().toLocaleString() + '\n';
        txt += '总计: ' + capturedChats.length + ' 条消息\n';
        txt += '='.repeat(50) + '\n\n';

        capturedChats.forEach((chat, i) => {
          txt += `【${i + 1}】${chat.role === 'user' ? '用户' : 'DeepSeek'}\n`;
          if (chat.isFile) txt += '(询问内容在文件中)\n';
          txt += '-'.repeat(30) + '\n';
          txt += chat.text + '\n\n';
        });

        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = (capturedChats[0]?.title || 'chat').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
        a.download = 'ds_chat_' + fileName + '_' + Date.now() + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      const captureChatBtn = document.getElementById('nf-capture-chat-btn');
      if (captureChatBtn) captureChatBtn.addEventListener('click', captureDeepSeekChat);

      const exportChatBtn = document.getElementById('nf-export-chat-btn');
      if (exportChatBtn) exportChatBtn.addEventListener('click', exportChatToTxt);

      const clearChatBtn = document.getElementById('nf-clear-chat-btn');
      if (clearChatBtn) clearChatBtn.addEventListener('click', () => {
        if (!confirm('确定要清除缓存的聊天记录吗？')) return;
        capturedChats = [];
        if (chrome?.storage?.local) {
          chrome.storage.local.remove(['nf_captured_chats', 'nf_chats_timestamp']);
        }
        renderCapturedChats();
      });

      document.getElementById('nf-tab-chat').onclick = () => {
        switchTab('chat');
        loadChatsFromStorage().then(chats => {
          if (chats.length > 0) {
            capturedChats = chats;
            renderCapturedChats();
          }
        });
      };

      function updateChapterHint() {
        const hint = document.getElementById('nf-chapter-hint');
        if (!hint) return;
        const sel = document.getElementById('nf-novel-sel');
        if (!sel?.value) { hint.textContent = ''; return; }
        const chapters = [...document.querySelectorAll('#nf-chapter-sel option')];
        const idx = chapters.findIndex(o => o.value === currentChapterId);
        if (idx < 0) { hint.textContent = ''; return; }
        const chapterNum = idx + 1;
        hint.innerHTML = idx === 0
          ? `<span style="color:#ea6a28">第${chapterNum}章（第一章，无前章上下文）</span>`
          : `<span style="color:#16a34a">第${chapterNum}章 · 将包含前章剧情</span>`;
      }

      // Auto switch to novel tab if coming from free mode
      if (freeModeActive && projectId) {
        switchTab('novel');
      }

      // Restore saved project and prefs
      chrome.storage.local.get(['nf_pid', 'nf_prefs'], (d) => {
        if (d.nf_pid) {
          projectId = d.nf_pid;
          const sel = document.getElementById('nf-sel');
          if (sel) sel.value = projectId;
          const exportBtn = document.getElementById('nf-export-btn');
          if (exportBtn && projectId) exportBtn.style.display = 'inline-block';
        }
        if (!freeModeActive) {
          loadPrefs(d.nf_prefs);
        }
        startDsObserver();
      });
    }

    function startDsObserver() {
      if (dsObserver || dsPollInterval) return;
      let retryCount = 0;
      const maxRetries = 60;
      let lastContent = '';
      const selectors = [
        '.ds-assistant-message-main-content',
        '.ds-markdown',
        '[data-selector="chat-message-content"]',
        '[class*="assistant-message"]',
        '[class*="message-content"]',
        '.markdown-body',
        'pre.code-block'
      ];

      const getContent = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            return (el.innerText || el.textContent || '').trim();
          }
        }
        return '';
      };

      const tryObserve = () => {
        if (retryCount++ > maxRetries) {
          console.log('[NF] DS observer: max retries reached');
          return;
        }
        const el = document.querySelector(selectors[0]);
        if (el) {
          console.log('[NF] DS observer: found target with selector:', selectors[0]);
          dsPollInterval = setInterval(() => {
            const content = getContent();
            if (content && content !== lastContent && content.length > 30) {
              console.log('[NF] Content changed, new length:', content.length);
              lastContent = content;
              capturedDsContent = content;
              updateDsCaptureUI(content);
            }
          }, 500);
        } else {
          setTimeout(tryObserve, 500);
        }
      };
      tryObserve();
    }

    function updateDsCaptureUI(text) {
      const area = document.getElementById('nf-ds-capture-area');
      if (!area) return;
      area.style.display = 'block';
      const preview = document.getElementById('nf-ds-preview');
      const badge = document.getElementById('nf-ds-badge');
      if (preview) {
        preview.textContent = text.substring(0, 300) + (text.length > 300 ? '...' : '');
        preview.classList.toggle('truncated', text.length > 300);
      }
      if (badge) badge.style.display = 'inline-block';
      const importBtn = document.getElementById('nf-import-chapter-btn');
      if (importBtn) importBtn.style.display = 'inline-block';
    }

    function showDsModal() {
      const modal = document.getElementById('nf-ds-modal');
      const body = document.getElementById('nf-modal-body');
      const titleEl = document.getElementById('nf-modal-title');
      if (modal && body) {
        body.textContent = capturedDsContent;
        if (titleEl) titleEl.textContent = 'DeepSeek 完整回复';
        modal.classList.add('active');
      }
    }

    function formatChapterText(text) {
      const lines = text.split('\n');
      const paragraphs = [];
      let currentParagraph = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          if (currentParagraph.length > 0) {
            paragraphs.push(currentParagraph.join('\n'));
            currentParagraph = [];
          }
        } else {
          currentParagraph.push(trimmed);
        }
      }
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join('\n'));
      }

      return paragraphs.map((p, i) => {
        if (i === 0) return p;
        return '\u3000\u3000' + p;
      }).join('\n\n');
    }

    async function importChapterFromDs() {
      if (!capturedDsContent) { alert('没有可导入的内容'); return; }
      if (!projectId || !currentChapterId) { alert('请先选择项目和章节'); return; }

      let text = capturedDsContent.replace(/\\n/g, '\n');

      const json = extractJSON(text);
      let content = json ? (json.content || text) : text;
      const title = json?.title || null;

      content = content.replace(/\\n/g, '\n');
      content = formatChapterText(content);

      const res = await msg('SAVE_CHAPTER_CONTENT', {
        projectId,
        chapterId: currentChapterId,
        content: content,
        title: title
      });

      if (res.ok) {
        alert('章节内容已保存！');
      } else {
        alert('保存失败: ' + (res.error || '未知错误'));
      }
    }

    async function importChapterFromDsText(text) {
      if (!text) { alert('没有可导入的内容'); return; }
      if (!projectId || !currentChapterId) { alert('请先选择项目和章节'); return; }

      text = text.replace(/\\n/g, '\n');

      const json = extractJSON(text);
      let content = json ? (json.content || text) : text;
      const title = json?.title || null;

      content = content.replace(/\\n/g, '\n');
      content = formatChapterText(content);

      const res = await msg('SAVE_CHAPTER_CONTENT', {
        projectId,
        chapterId: currentChapterId,
        content: content,
        title: title
      });

      if (res.ok) {
        alert('章节内容已保存！');
      } else {
        alert('保存失败: ' + (res.error || '未知错误'));
      }
    }

    async function doImport() {
      if (!projectId) { alert('请先在上方选择一个项目'); return; }
      const text = document.getElementById('nf-ds-text').value.trim();
      const result = document.getElementById('nf-result');
      const btn = document.getElementById('nf-go');
      if (!text) { alert('请粘贴 DeepSeek 回复'); return; }

      btn.textContent = '解析中...'; btn.disabled = true;
      result.textContent = ''; result.className = 'nf-msg';

      const json = extractJSON(text);
      if (!json) {
        result.textContent = '未找到有效 JSON';
        result.className = 'nf-msg nf-err';
        btn.textContent = '解析并导入'; btn.disabled = false;
        return;
      }

      btn.textContent = '导入中...';
      const res = await msg('IMPORT_DATA', { projectId, data: json });
      if (res.ok) {
        const r = res.data;
        const p = [];
        if (r.world_modules_created) p.push(r.world_modules_created + '个世界观');
        if (r.world_rules_created) p.push(r.world_rules_created + '条规则');
        if (r.characters_created) p.push(r.characters_created + '个角色');
        if (r.relationships_created) p.push(r.relationships_created + '条关系');
        result.textContent = '导入成功: ' + p.join(', ');
        result.className = 'nf-msg nf-ok';
      } else {
        result.textContent = '导入失败: ' + res.error;
        result.className = 'nf-msg nf-err';
      }
      btn.textContent = '解析并导入'; btn.disabled = false;
    }

    async function doCopyAsk() {
      const text = document.getElementById('nf-ask').value.trim();
      if (!text) { alert('请输入提问内容'); return; }

      const genType = document.getElementById('nf-gen-type').value;
      const moduleChecks = document.querySelectorAll('.nf-module-check:checked');
      const selectedModules = Array.from(moduleChecks).map(el => el.value);

      let prompt = '';
      let jsonFormat = '';

      if (genType === 'world') {
        const moduleLabels = {
          era: '时代背景', geography: '地理环境', magic: '超凡体系',
          politics: '政治体系', race: '种族设定', religion: '宗教信仰',
          history: '历史事件', culture: '社会文化', economy: '经济体系'
        };
        const selectedLabels = selectedModules.map(m => moduleLabels[m] || m).join('、');
        prompt = `${text}\n\n请生成以下世界观模块：${selectedLabels}。\n\n请严格按照以下JSON格式返回，只返回纯JSON，不要其他文字：\n\n`;
        jsonFormat = `{
  "world_modules": [
    {
      "module_type": "${selectedModules.join('|')}",
      "title": "模块标题",
      "content": "详细的Markdown内容",
      "tags": "标签1,标签2"
    }
  ],
  "world_rules": [
    { "content": "硬规则内容", "priority": 1 }
  ]
}`;
      } else if (genType === 'characters') {
        prompt = `${text}\n\n请生成角色设定。\n\n请严格按照以下JSON格式返回，只返回纯JSON，不要其他文字：\n\n`;
        jsonFormat = `{
  "characters": [
    {
      "name": "角色名",
      "gender": "性别",
      "age": "年龄",
      "appearance": "外貌描述",
      "personality": "性格描述",
      "abilities": "能力/技能",
      "background": "背景故事",
      "status": "当前状态",
      "quotes": "经典语录"
    }
  ]
}`;
      } else if (genType === 'relationships') {
        prompt = `${text}\n\n请生成角色关系。\n\n请严格按照以下JSON格式返回，只返回纯JSON，不要其他文字：\n\n`;
        jsonFormat = `{
  "relationships": [
    {
      "from_name": "角色A的名字",
      "to_name": "角色B的名字",
      "relation_type": "关系类型(亲人/朋友/敌人/恋人/师徒/上下级/盟友/宿敌)",
      "intimacy": 50,
      "description": "关系描述"
    }
  ]
}`;
      } else {
        const moduleLabels = {
          era: '时代背景', geography: '地理环境', magic: '超凡体系',
          politics: '政治体系', race: '种族设定', religion: '宗教信仰',
          history: '历史事件', culture: '社会文化', economy: '经济体系'
        };
        const selectedLabels = selectedModules.map(m => moduleLabels[m] || m).join('、');
        prompt = `${text}\n\n请生成完整的世界观设定（${selectedLabels}）、角色、角色关系和硬规则。\n\n请严格按照以下JSON格式返回，只返回纯JSON，不要其他文字：\n\n`;
        jsonFormat = `{
  "world_modules": [
    { "module_type": "era|geography|magic|politics|race|religion|history|culture|economy", "title": "标题", "content": "内容", "tags": "标签" }
  ],
  "world_rules": [
    { "content": "硬规则内容", "priority": 1 }
  ],
  "characters": [
    { "name": "角色名", "gender": "", "age": "", "appearance": "", "personality": "", "abilities": "", "background": "", "status": "", "quotes": "" }
  ],
  "relationships": [
    { "from_name": "角色A", "to_name": "角色B", "relation_type": "朋友", "intimacy": 80, "description": "" }
  ]
}`;
      }

      const fullPrompt = prompt + jsonFormat;

      await navigator.clipboard.writeText(fullPrompt);
      const btn = document.getElementById('nf-copy');
      btn.textContent = '已复制!';
      btn.style.background = '#16a34a'; btn.style.color = '#fff';
      setTimeout(() => { btn.textContent = '复制提问（含JSON格式）'; btn.style.background = ''; btn.style.color = ''; }, 2000);
    }

    function extractJSON(text) {
      let c = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      try { return JSON.parse(c); } catch { }
      const s = c.indexOf('{'), e = c.lastIndexOf('}');
      if (s !== -1 && e > s) { try { return JSON.parse(c.substring(s, e + 1)); } catch { } }
      return null;
    }

    const MODULE_LABELS = {
      era: '时代背景', geography: '地理环境', magic: '超凡体系',
      politics: '政治体系', race: '种族设定', religion: '宗教信仰',
      history: '历史事件', culture: '社会文化', economy: '经济体系'
    };

    async function doExportTxt() {
      if (!projectId) { alert('请先选择一个项目'); return; }
      const btn = document.getElementById('nf-export-btn');
      btn.textContent = '导出中...'; btn.disabled = true;

      try {
        const res = await msg('GET_ALL_PROJECT_DATA', { projectId });
        if (!res.ok) {
          alert('获取项目数据失败: ' + res.error);
          btn.textContent = '导出项目为TXT'; btn.disabled = false;
          return;
        }

        const { modules, rules, characters, relationships } = res.data;
        const selectedProject = projects.find(p => p.id === projectId);
        const projectTitle = selectedProject ? selectedProject.title : '项目';

        const lines = [];
        lines.push(`# ${projectTitle}`);
        lines.push('');
        lines.push('---');
        lines.push('');

        if (modules.length > 0) {
          lines.push('## 世界观设定');
          lines.push('');
          const grouped = {};
          modules.forEach(m => {
            if (!grouped[m.module_type]) grouped[m.module_type] = [];
            grouped[m.module_type].push(m);
          });
          Object.keys(grouped).sort().forEach(type => {
            const label = MODULE_LABELS[type] || type;
            lines.push(`### ${label}`);
            lines.push('');
            grouped[type].forEach(m => {
              if (m.title) lines.push(`**${m.title}**`);
              lines.push(m.content || '');
              if (m.tags) lines.push(`标签: ${m.tags}`);
              lines.push('');
            });
          });
        }

        if (rules.length > 0) {
          lines.push('## 硬规则');
          lines.push('');
          rules.sort((a, b) => b.priority - a.priority).forEach(r => {
            lines.push(`- [P${r.priority}] ${r.content}`);
          });
          lines.push('');
        }

        if (characters.length > 0) {
          lines.push('## 角色设定');
          lines.push('');
          characters.forEach(c => {
            lines.push(`### ${c.name}`);
            if (c.gender) lines.push(`性别: ${c.gender}`);
            if (c.age) lines.push(`年龄: ${c.age}`);
            if (c.status) lines.push(`状态: ${c.status}`);
            if (c.personality) lines.push(`性格: ${c.personality}`);
            if (c.appearance) lines.push(`外貌: ${c.appearance}`);
            if (c.abilities) lines.push(`能力: ${c.abilities}`);
            if (c.background) lines.push(`背景: ${c.background}`);
            if (c.quotes) lines.push(`语录: "${c.quotes}"`);
            lines.push('');
          });
        }

        if (relationships.length > 0) {
          lines.push('## 角色关系');
          lines.push('');
          relationships.forEach(r => {
            lines.push(`- ${r.from_name} → ${r.relation_type} → ${r.to_name} (亲密度: ${r.intimacy})`);
            if (r.description) lines.push(`  ${r.description}`);
          });
          lines.push('');
        }

        lines.push('---');
        lines.push('');
        lines.push('## AI生成提示词模板');
        lines.push('');
        lines.push('以下JSON格式可用于AI辅助生成内容：');
        lines.push('');
        lines.push('### 世界观生成格式');
        lines.push('```json');
        lines.push(`{
  "world_modules": [
    {
      "module_type": "era|geography|magic|politics|race|religion|history|culture|economy",
      "title": "模块标题",
      "content": "详细的Markdown内容",
      "tags": "标签1,标签2"
    }
  ],
  "world_rules": [
    { "content": "硬规则内容", "priority": 1 }
  ]
}`);
        lines.push('```');
        lines.push('');
        lines.push('### 角色生成格式');
        lines.push('```json');
        lines.push(`{
  "characters": [
    {
      "name": "角色名",
      "gender": "性别",
      "age": "年龄",
      "appearance": "外貌描述",
      "personality": "性格描述",
      "abilities": "能力/技能",
      "background": "背景故事",
      "status": "当前状态",
      "quotes": "经典语录"
    }
  ]
}`);
        lines.push('```');
        lines.push('');
        lines.push('### 角色关系生成格式');
        lines.push('```json');
        lines.push(`{
  "relationships": [
    {
      "from_name": "角色A的名字",
      "to_name": "角色B的名字",
      "relation_type": "关系类型(亲人/朋友/敌人/恋人/师徒/上下级/盟友/宿敌)",
      "intimacy": 50,
      "description": "关系描述"
    }
  ]
}`);
        lines.push('```');

        const txtContent = lines.join('\n');
        const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectTitle}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        btn.textContent = '已导出!';
        btn.style.background = '#16a34a'; btn.style.color = '#fff';
        setTimeout(() => { btn.textContent = '导出项目为TXT'; btn.style.background = ''; btn.style.color = ''; }, 2000);
      } catch (e) {
        alert('导出失败: ' + e.message);
        btn.textContent = '导出项目为TXT'; btn.disabled = false;
      }
    }

    async function doGenChapterPrompt() {
      const sel = document.getElementById('nf-novel-sel');
      const pid = sel?.value;
      const cid = document.getElementById('nf-chapter-sel')?.value;

      if (!pid) { alert('请先选择一个项目'); return; }
      if (!cid) { alert('请先选择一个章节'); return; }

      const dataRes = await msg('GET_ALL_PROJECT_DATA', { projectId: pid, chapterId: cid });
      if (!dataRes.ok) { alert('获取项目数据失败'); return; }

      const raw = dataRes.data;
      const data = {
        modules: Array.isArray(raw?.modules) ? raw.modules : [],
        rules: Array.isArray(raw?.rules) ? raw.rules : [],
        characters: Array.isArray(raw?.characters) ? raw.characters : [],
        relationships: Array.isArray(raw?.relationships) ? raw.relationships : [],
        chapters: Array.isArray(raw?.chapters) ? raw.chapters : (raw?.chapters?.items ? raw.chapters.items : []),
        previousChapter: raw?.previousChapter || null,
        currentChapter: raw?.currentChapter || null
      };

      const includeWorld = document.getElementById('nf-include-world').checked;
      const includeRules = document.getElementById('nf-include-rules').checked;
      const includeChars = document.getElementById('nf-include-chars').checked;
      const includeRels = document.getElementById('nf-include-rels').checked;
      const includePrev = document.getElementById('nf-include-prev-chapter').checked;
      const userRequest = document.getElementById('nf-user-request').value.trim();

      currentChapterId = cid;
      const prompt = buildChapterPrompt({ data, includeWorld, includeRules, includeChars, includeRels, includePrev, userRequest });

      const chapters = data?.chapters || [];
      const sortedChapters = [...chapters].sort((a, b) => (a.order || 0) - (b.order || 0));
      const idx = sortedChapters.findIndex(c => c.id === cid);
      const chapterNum = idx >= 0 ? idx + 1 : 1;

      const blob = new Blob([prompt], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `第${chapterNum}章_写作提示词_${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const result = document.getElementById('nf-chapter-result');
      if (result) {
        result.textContent = `已生成：第${chapterNum}章_写作提示词.txt`;
        result.style.color = '#16a34a';
        setTimeout(() => { if (result) result.textContent = ''; }, 3000);
      }
    }

    function buildChapterPrompt({ data, includeWorld, includeRules, includeChars, includeRels, includePrev, userRequest }) {
      const chapters = data?.chapters || [];
      const sortedChapters = [...chapters].sort((a, b) => (a.order || 0) - (b.order || 0));
      const idx = sortedChapters.findIndex(c => c.id === currentChapterId);
      const chapterNum = idx >= 0 ? idx + 1 : 1;

      let prompt = `# 小说写作辅助 - 第${chapterNum}章\n\n`;

      if (includePrev && data?.previousChapter) {
        prompt += `## 前章剧情摘要\n\n上一章「${data.previousChapter.title || '第' + (idx) + '章'}」内容：\n${stripHtml(data.previousChapter.content || '').substring(0, 2000)}\n\n---\n\n`;
      }

      if (includeWorld && data?.modules?.length > 0) {
        prompt += `## 世界观设定\n\n`;
        const grouped = {};
        data.modules.forEach(m => {
          if (!grouped[m.module_type]) grouped[m.module_type] = [];
          grouped[m.module_type].push(m);
        });
        for (const [type, mods] of Object.entries(grouped)) {
          prompt += `### ${MODULE_LABELS[type] || type}\n`;
          mods.forEach(m => { prompt += `- **${m.title}**：${stripHtml(m.content || '')}\n`; });
          prompt += '\n';
        }
      }

      if (includeRules && data?.rules?.length > 0) {
        prompt += `## 硬规则（不可违反）\n\n`;
        [...data.rules].sort((a, b) => (a.priority || 0) - (b.priority || 0)).forEach(r => { prompt += `- [优先级${r.priority || 0}] ${r.content}\n`; });
        prompt += '\n';
      }

      if (includeChars && data?.characters?.length > 0) {
        prompt += `## 角色信息\n\n`;
        data.characters.forEach(c => {
          prompt += `### ${c.name}\n`;
          if (c.personality) prompt += `- 性格：${c.personality}\n`;
          if (c.appearance) prompt += `- 外貌：${c.appearance}\n`;
          if (c.background) prompt += `- 背景：${c.background}\n`;
          if (c.abilities) prompt += `- 能力：${c.abilities}\n`;
          prompt += '\n';
        });
      }

      if (includeRels && data?.relationships?.length > 0) {
        prompt += `## 角色关系\n\n`;
        data.relationships.forEach(r => {
          prompt += `- ${r.from_name} ${r.relation_type} ${r.to_name}`;
          if (r.intimacy) prompt += ` [亲密度: ${r.intimacy}]`;
          if (r.description) prompt += ` - ${r.description}`;
          prompt += '\n';
        });
        prompt += '\n';
      }

      if (userRequest) {
        prompt += `## 当前章节写作要求\n\n${userRequest}\n\n`;
      }

      prompt += `---\n\n请根据以上设定，创作第${chapterNum}章内容。要求：\n1. 严格遵循世界观设定和硬规则\n2. 注意角色性格和能力的一致性\n3. 推进合理的剧情发展\n4. 字数要求：2000-5000字\n\n请以Markdown格式输出小说章节内容。\n\n【重要】如果需要将内容导入小说编辑器，请同时返回一个JSON对象，格式如下：\n\`\`\`json\n{\n  "title": "章节标题（如：第${chapterNum}章 标题）",\n  "content": "这里是完整的章节正文内容（纯文本，不含Markdown格式，所有段落之间用换行符分隔）"\n}\n\`\`\`\n请将JSON块放在Markdown内容的最后。`;

      return prompt;
    }

    function stripHtml(html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.textContent || div.innerText || '';
    }

    function getDSStructure() {
      const selectors = [
        '.ds-assistant-message-main-content',
        '[class*="message"]',
        '[class*="chat"]',
        '[class*="conversation"]',
        'textarea',
        '[class*="input"]'
      ];

      let report = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>DS Page Structure</title>';
      report += '<style>body{font-family:monospace;padding:20px;line-height:1.5}';
      report += '.el{margin:10px 0;padding:10px;border:1px solid #ccc;background:#f9f9f9}';
      report += '.el h3{margin:0 0 10px 0;color:#333}';
      report += '.css{font-size:12px;color:#666;margin:5px 0}';
      report += '.html{font-size:12px;word-break:break-all}';
      report += 'pre{background:#fff;border:1px solid #eee;padding:10px;overflow-x:auto}';
      report += '</style></head><body>';
      report += '<h1>DeepSeek Page Structure Analysis</h1>';
      report += '<p>Generated at: ' + new Date().toLocaleString() + '</p>';
      report += '<h2>Selectors found:</h2><ul>';
      selectors.forEach(s => report += '<li>' + s + '</li>');
      report += '</ul>';

      let foundCount = 0;
      selectors.forEach(sel => {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          foundCount++;
          report += '<div class="el"><h3>Selector: ' + sel + ' (Found: ' + els.length + ')</h3>';
          els.forEach((el, i) => {
            const style = window.getComputedStyle(el);
            const cssText = [
              'display: ' + style.display,
              'position: ' + style.position,
              'width: ' + style.width,
              'height: ' + style.height,
              'overflow: ' + style.overflow,
              'className: ' + el.className,
              'id: ' + (el.id || 'none')
            ].join('; ');

            let htmlSnippet = el.outerHTML || el.innerHTML || '';
            if (htmlSnippet.length > 2000) htmlSnippet = htmlSnippet.substring(0, 2000) + '... (truncated)';

            report += '<div class="css"><strong>Element ' + (i + 1) + '</strong>: ' + cssText + '</div>';
            report += '<div class="html"><strong>HTML:</strong><pre>' + escapeHtml(htmlSnippet) + '</pre></div>';
          });
          report += '</div>';
        }
      });

      if (foundCount === 0) {
        report += '<p>No matching elements found. The page may use virtual scrolling or dynamic rendering.</p>';
      }

      report += '<h2>Full Body Classes:</h2>';
      report += '<pre>' + escapeHtml(document.body.className) + '</pre>';
      report += '<h2>All First-Level Children:</h2>';
      Array.from(document.body.children).forEach((child, i) => {
        report += '<div class="el"><h3>Child ' + (i + 1) + ': ' + child.tagName + '</h3>';
        report += '<div class="css">class: ' + child.className + '</div>';
        report += '<div class="css">id: ' + (child.id || 'none') + '</div>';
        report += '</div>';
      });

      report += '</body></html>';

      const blob = new Blob([report], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ds_structure_' + Date.now() + '.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('[NF] Structure saved to file');
      return foundCount;
    }

    window.getDSStructure = getDSStructure;

    /** 页面加载后通知 background 同步 cookie */
    setTimeout(() => {
      try {
        if (typeof chrome?.runtime?.sendMessage === 'function' && chrome?.runtime?.id) {
          chrome.runtime.sendMessage({ type: 'SYNC_DS_COOKIE' });
        }
      } catch (e) { /* context invalidated, skip */ }
    }, 2000);

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function msg(type, data = {}) {
      try {
        if (typeof chrome?.runtime?.sendMessage === 'function' && chrome?.runtime?.id) {
          return new Promise(r => chrome.runtime.sendMessage({ type, ...data }, r));
        }
      } catch (e) {
        if (e.message?.includes('context invalidated') || e.message?.includes('context')) {
          console.log('[NF_CS] Extension context invalidated in msg()');
        }
      }
      return Promise.resolve({ ok: false, error: 'Extension context invalid' });
    }

    function safeSendMessage(msg) {
      try {
        if (chrome?.runtime?.id) {
          chrome.runtime.sendMessage(msg)
        }
      } catch (e) {
        if (e.message?.includes('context invalidated') || e.message?.includes('context')) {
          console.log('[NF_CS] Extension context invalidated, skipping sendMessage')
        } else {
          console.warn('[NF_CS] sendMessage error:', e.message)
        }
      }
    }

    // 接收 MAIN world 发来的消息，转发给 background
    // 用 content script 作用域的变量追踪当前任务 ID（MAIN world 的变量不可靠）
    let _csCurrentTaskId = ''
    let _pendingChunks = []  // 缓存 taskId 未设置时到达的 chunk
    let _lastSentLen = 0     // DOM 捕获用的发送长度追踪
    let _lastInterceptSentLen = 0  // 拦截器用的独立发送长度追踪（防止和 DOM 捕获互相干扰）
    let _doneTimer = null    // 最后一个 chunk 后延迟发送 DONE
    const DONE_DELAY = 8000  // 8 秒无新 chunk 才认为完成（DeepSeek 暂停后可能需要较长时间恢复）

    // [已弃用] DOM 前缀逻辑已移除 —— 拦截器直接捕获网络层累积文本，不需要 DOM 前缀

    function flushPendingChunks() {
      if (_csCurrentTaskId && _pendingChunks.length > 0) {
        // console.log('[NF_CS] Bridge: Flushing ' + _pendingChunks.length + ' pending chunks, taskId=' + _csCurrentTaskId)
        for (const chunk of _pendingChunks) {
          safeSendMessage({ type: 'DS_CHUNK', taskId: _csCurrentTaskId, content: chunk })
        }
        _pendingChunks = []
        window.__nf_interceptorActive = true
      }
    }

    window.addEventListener('message', (event) => {
      if (event.data?.source !== 'nf-main-world') return
      const { type, taskId, content, error } = event.data
      // 仅记录非 chunk 类型的消息（chunk 太多会刷屏）
      if (type !== 'net_CHUNK' && type !== 'DS_CHUNK') {
        console.log('[NF_CS] Bridge: received from MAIN world:', type, 'taskId=', taskId)
      }

      // 收到任务开始通知，记录 taskId 并刷新缓存
      if (type === 'net_TASK_START') {
        _csCurrentTaskId = taskId || ''
        _lastSentLen = 0  // 新任务重置
        _lastInterceptSentLen = 0  // 拦截器独立追踪重置
        console.log('[NF_CS] Bridge: Task started, _csCurrentTaskId=' + _csCurrentTaskId)
        flushPendingChunks()
        return
      }

      // 处理拦截器发来的 net_ 前缀消息（interceptor.js 在 MAIN world 运行，taskId 从 message 中获取）
      if (type === 'net_DS_STATE') {
        const activeTaskId = taskId || _csCurrentTaskId
        if (activeTaskId) {
          const state = event.data.state || 'idle'
          console.log('[NF_CS] Bridge: DS_STATE=' + state + ' taskId=' + activeTaskId)
          safeSendMessage({ type: 'DS_STATE', taskId: activeTaskId, state })
          // 在 CONTENT world 设置暂停标志（MAIN world 的 __nf_ds_paused 这里看不到）
          if (state === 'continue') {
            window.__nf_ds_paused = true
            console.log('[NF_CS] __nf_ds_paused set to true (CONTENT world)')
          }
        }
        return
      }
      if (type === 'net_CHUNK') {
        const activeTaskId = taskId || _csCurrentTaskId
        if (activeTaskId && content) {
          window.__nf_interceptorActive = true
          window.__nf_ds_paused = false  // 有新 chunk，清除暂停标志
          // 直接发送拦截器的累积文本，不需要 DOM 前缀
          if (content.length >= _lastInterceptSentLen) {
            _lastInterceptSentLen = content.length
            console.log('[NF_CS↑] Sending DS_CHUNK to bg, content_len=' + content.length)
            safeSendMessage({ type: 'DS_CHUNK', taskId: activeTaskId, content: content })
          }
          // 重置 DONE 定时器
          clearTimeout(_doneTimer)
          _doneTimer = setTimeout(() => {
            // DS 暂停时不发送 DONE —— 等待用户点击继续
            if (window.__nf_ds_paused) {
              console.log('[NF_CS] net_CHUNK timer: DS is paused, skipping DONE')
              return
            }
            safeSendMessage({ type: 'DS_DONE', taskId: activeTaskId })
            _csCurrentTaskId = ''
            _pendingChunks = []
          }, DONE_DELAY)
        } else if (content) {
          _pendingChunks.push(content)
        }
        return
      }
      // ★ 拦截器检测到 event:close，立即发送 DONE（不再等待 DONE_DELAY）
      if (type === 'net_DONE') {
        clearTimeout(_doneTimer)
        const activeTaskId = taskId || _csCurrentTaskId
        if (activeTaskId) {
          if (window.__nf_ds_paused) {
            console.log('[NF_CS] net_DONE: DS is paused, skipping DONE')
            return
          }
          console.log('[NF_CS] net_DONE: interceptor confirmed stream end, sending DS_DONE immediately')
          safeSendMessage({ type: 'DS_DONE', taskId: activeTaskId })
          _csCurrentTaskId = ''
          _pendingChunks = []
          _lastInterceptSentLen = 0
        }
        return
      }

      // [弃用] DOM 捕获：已改用拦截器方案（interceptor.js 直接捕获 SSE 原始数据）
      // DOM 捕获仅保留 DONE 定时器作为兜底（拦截器未激活时的后备机制）
      if (type === 'DS_CHUNK') {
        if (content) {
          const activeTaskId = taskId || _csCurrentTaskId
          window.__nf_ds_paused = false
          // [弃用] DOM DONE 定时器：拦截器已有 event:close 检测，此处仅为兜底
          clearTimeout(_doneTimer)
          if (activeTaskId && !window.__nf_interceptorActive) {
            _doneTimer = setTimeout(() => {
              if (window.__nf_ds_paused) {
                console.log('[NF_CS] DS_CHUNK timer: DS is paused, skipping DONE')
                return
              }
              console.log('[NF_CS] DOM fallback: No new chunks, sending DONE')
              safeSendMessage({ type: 'DS_DONE', taskId: activeTaskId })
              _csCurrentTaskId = ''
              _pendingChunks = []
            }, DONE_DELAY)
          }
        }
      } else if (type === 'DS_DONE') {
        // 永远阻止 DOM 的 DONE（用定时器控制结束时机）
        if (window.__nf_interceptorActive) return
        console.log('[NF_CS] Bridge: forwarding DS_DONE to background')
        safeSendMessage({ type: 'DS_DONE', taskId })
      } else if (type === 'DS_ERROR') {
        console.log('[NF_CS] Bridge: forwarding DS_ERROR to background:', error)
        safeSendMessage({ type: 'DS_ERROR', taskId, error })
      }
    })

    // 接收 background 的注入请求，通过 <script> 标签注入到 MAIN world
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      // 收到 SET_TASK_ID，提前设置 taskId（比 net_TASK_START 更早）
      if (msg.type === 'SET_TASK_ID') {
        _csCurrentTaskId = msg.taskId || ''
        console.log('[NF_CS] SET_TASK_ID received, _csCurrentTaskId=' + _csCurrentTaskId)
        flushPendingChunks()
        sendResponse({ ok: true })
        return true
      }
      if (msg.type === 'INJECT_TRIGGER') {
        console.log('[NF_CS] INJECT_TRIGGER received, taskId=', msg.taskId)
        _csCurrentTaskId = msg.taskId || ''
        window.__nf_interceptorActive = false
        try {
          const script = document.createElement('script')
          script.textContent = `(${msg.handlerCode})(${JSON.stringify(msg.taskId)}, ${JSON.stringify(msg.userMessage)}, ${JSON.stringify(msg.contextTxt)});`
          document.head.appendChild(script)
          script.remove()
          sendResponse({ ok: true })
        } catch (e) {
          console.error('[NF_CS] INJECT_TRIGGER failed:', e.message)
          sendResponse({ ok: false, error: e.message })
        }
        return true
      }
    })

    try {
      chrome.storage.local.get('nf_pid', (d) => { projectId = d.nf_pid || ''; });
    } catch (e) {
      console.warn('[NF] Storage access failed:', e);
    }
  } catch (e) {
    console.error('[NF] Extension error:', e);
  }
})();
