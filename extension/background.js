// NovelForge Background Service Worker

const API_BASE = 'http://localhost:9000/api/v1';

let authToken = '';
let refreshToken = '';
let savedAccount = '';
let savedPassword = '';

// Service Worker 启动时从 storage 恢复认证状态（MV3 下 SW 会频繁重启）
chrome.storage.local.get(['authToken', 'refreshToken', 'savedAccount', 'savedPassword'], (data) => {
  if (data.authToken) authToken = data.authToken;
  if (data.refreshToken) refreshToken = data.refreshToken;
  if (data.savedAccount) savedAccount = data.savedAccount;
  if (data.savedPassword) savedPassword = data.savedPassword;
  console.log('[NF] Auth state restored from storage, hasToken:', !!authToken, 'hasRefresh:', !!refreshToken);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LOGIN') {
    login(msg.account, msg.password).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_PROJECTS') {
    apiGet('/projects').then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_WORLD') {
    apiGet(`/projects/${msg.projectId}/world`).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_CHARACTERS') {
    apiGet(`/projects/${msg.projectId}/characters`).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_RULES') {
    apiGet(`/projects/${msg.projectId}/world-rules`).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_RELATIONSHIPS') {
    apiGet(`/projects/${msg.projectId}/characters/relationships`).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_CHAPTERS') {
    apiGet(`/projects/${msg.projectId}/chapters`).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_CHAPTER') {
    apiGet(`/projects/${msg.projectId}/chapters/${msg.chapterId}`).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_ALL_PROJECT_DATA') {
    getAllProjectData(msg.projectId).then(sendResponse);
    return true;
  }
  if (msg.type === 'INJECT') {
    buildPrompt(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'IMPORT_DATA') {
    importData(msg.projectId, msg.data).then(sendResponse);
    return true;
  }
  if (msg.type === 'SAVE_CHAPTER_CONTENT') {
    const body = { content: msg.content };
    if (msg.title) body.title = msg.title;
    apiPut(`/projects/${msg.projectId}/chapters/${msg.chapterId}`, body).then(sendResponse);
    return true;
  }
  if (msg.type === 'SET_TOKEN') {
    authToken = msg.token || '';
    refreshToken = msg.refreshToken || '';
    chrome.storage.local.set({ authToken, refreshToken });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'GET_TOKEN') {
    chrome.storage.local.get('authToken', (data) => {
      authToken = data.authToken || '';
      sendResponse({ token: authToken });
    });
    return true;
  }
  if (msg.type === 'CLEAR_AUTH') {
    clearAuth().then(sendResponse);
    return true;
  }
  if (msg.type === 'SYNC_DS_COOKIE') {
    syncDSCookieFromTab().then(sendResponse);
    return true;
  }
  if (msg.type === 'SYNC_NF_TOKEN') {
    syncNfTokenFromTab().then(sendResponse);
    return true;
  }
  if (msg.type === 'DS_CHUNK') {
    console.log('[NF_BG] DS_CHUNK received: content_len=' + (msg.content?.length || 0) + ' _directMode=' + _directMode + ' webAppTabs=' + _webAppTabIds.size)
    sendToWebApp({ type: 'DIRECT_CHAT_CHUNK', content: msg.content })
    forwardChatChunk(msg.taskId, 'chunk', { content: msg.content }).then(sendResponse);
    return true;
  }
  if (msg.type === 'DS_DONE') {
    console.log('[NF_BG] Step 5: Received DS_DONE, taskId:', msg.taskId)
    sendToWebApp({ type: 'DIRECT_CHAT_DONE' })
    forwardChatChunk(msg.taskId, 'done', {}).then(sendResponse);
    currentTaskId = null;
    return true;
  }
  if (msg.type === 'DS_STATE') {
    console.log('[NF_BG] DS_STATE:', msg.state, 'taskId:', msg.taskId)
    sendToWebApp({ type: 'DIRECT_CHAT_STATE', state: msg.state })
    const token_p = getToken().then(token => {
      if (!token) return
      return fetch(`${API_BASE}/free-deepseek/extension-chat/${msg.taskId}/state`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: msg.state })
      })
    }).catch(e => console.warn('[NF_BG] DS_STATE forward error:', e.message))
    sendResponse({ ok: true })
    return true
  }
  if (msg.type === 'DS_ERROR') {
    console.log('[NF_BG] Step 5: Received DS_ERROR, taskId:', msg.taskId, 'error:', msg.error)
    sendToWebApp({ type: 'DIRECT_CHAT_ERROR', error: msg.error })
    forwardChatChunk(msg.taskId, 'error', { error: msg.error }).then(sendResponse);
    currentTaskId = null;
    return true;
  }
  if (msg.type === 'HEARTBEAT_ON_VISIBLE') {
    // 标签页切回前台，立即发心跳让后端更新扩展连接状态
    sendHeartbeat().then(() => sendResponse({ ok: true }))
    return true
  }
  // ====== 直连通道：前端通过扩展直接发消息给 DS ======
  if (msg.type === 'DIRECT_CHAT_SEND') {
    console.log('[NF_BG] DIRECT_CHAT_SEND received, content_len=' + (msg.content?.length || 0))
    _directMode = true
    // 记录前端标签页
    if (sender?.tab?.id) {
      _webAppTabIds.add(sender.tab.id)
      console.log('[NF_BG] Registered web app tab: ' + sender.tab.id + ', total=' + _webAppTabIds.size)
    } else {
      console.warn('[NF_BG] No sender.tab.id! sender=', JSON.stringify(sender?.tab))
    }
    // 通过后端创建任务（复用现有任务队列机制）
    directChatSend(msg.content, msg.projectId, msg.includeContext, msg.temperature).then(sendResponse)
    return true
  }
  if (msg.type === 'DIRECT_GEN_SEND') {
    console.log('[NF_BG] DIRECT_GEN_SEND received')
    _directMode = true
    if (sender?.tab?.id) _webAppTabIds.add(sender.tab.id)
    directGenSend(msg.messages, msg.projectId, msg.includeContext, msg.temperature, msg.isContinue).then(sendResponse)
    return true
  }
  if (msg.type === 'GET_DS_STATUS') {
    const cachedOpen = _deepseekTabIds.size > 0
    chrome.tabs.query({ url: 'https://chat.deepseek.com/*' }).then(tabs => {
      if (tabs.length > 0) {
        tabs.forEach(t => _deepseekTabIds.add(t.id))
      }
      sendResponse({
        sseConnected,
        sseLastError,
        lastHeartbeat,
        currentTaskId,
        dsTabOpen: tabs.length > 0 || cachedOpen
      });
    }).catch(() => {
      sendResponse({
        sseConnected,
        sseLastError,
        lastHeartbeat,
        currentTaskId,
        dsTabOpen: cachedOpen
      });
    });
    return true;
  }
});

setTimeout(syncNfTokenFromTab, 2000);

// SSE 长连接：后端有任务时主动推送，零轮询
let currentTaskId = null
let currentTaskStartTime = 0
let sseConnected = false
let sseLastError = null
let lastHeartbeat = 0
let heartbeatTimer = null
let _deepseekTabIds = new Set()
let _webAppTabIds = new Set()  // 前端页面标签页 ID
let _directMode = false  // 是否使用直连模式（前端通过扩展直连，不经过后端 SSE）

// 向前端标签页发送消息（直连通道下行）
async function sendToWebApp(msg) {
  if (!_directMode || _webAppTabIds.size === 0) return
  const dead = []
  for (const tabId of _webAppTabIds) {
    try {
      await chrome.tabs.sendMessage(tabId, msg)
    } catch (e) {
      dead.push(tabId)
    }
  }
  dead.forEach(id => _webAppTabIds.delete(id))
}

// === webRequest 在 MV3 中不支持 filterResponseData，已禁用 ===
// 数据捕获通过 MAIN world 的 XHR/ReadableStream/fetch 拦截器实现
function startDsNetworkInterceptor() {
  console.log('[NF_BG] webRequest filterResponseData not available in MV3, using MAIN world interceptors only')
}

function startChatListening() {
  detectNfFrontend()
  startPolling()
  installPersistentInterceptorOnAllDsTabs()
}

// ---- 持久化网络拦截器（一次性安装，在 MAIN world 中持续运行）----
// 使用 chrome.scripting.executeScript({ world: 'MAIN' }) 绕过 CSP
// 拦截 ReadableStream.prototype.getReader + window.fetch
// 数据通过 window.__nf_currentTaskId + window.postMessage → inject.js bridge → background
async function installPersistentInterceptorOnAllDsTabs() {
  console.log('[NF_BG] Persistent interceptor disabled - interceptor.js handles SSE capture')
}

async function installInterceptorOnTab(tabId) {
  try {
    // 用 executeScript 注入持久拦截器到 MAIN world（绕过 CSP）
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: persistentNetworkInterceptor
    })
    console.log('[NF_BG] Persistent network interceptor installed on tab', tabId)
  } catch (e) {
    console.warn('[NF_BG] installInterceptorOnTab failed:', e.message)
  }
}

// 持久拦截器函数——在 DS 页面的 MAIN world 中运行
// 必须是独立函数（不引用外部变量），因为会被序列化后注入
function persistentNetworkInterceptor() {
  // 防止重复安装
  if (window.__nf_interceptorInstalled) return
  window.__nf_interceptorInstalled = true

  console.log('[NF_NET] Installing persistent interceptors (ReadableStream + fetch)...')

  function sendToCs(type, data) {
    try {
      window.postMessage({ source: 'nf-main-world', type: 'net_' + type, ...data }, '*')
    } catch (e) {
      console.warn('[NF_NET] postMessage error:', e.message)
    }
  }

  // 每个任务的独立状态（通过 __nf_currentTaskId 隔离）
  let cumulativeText = ''
  let captureDone = false

  function resetState() {
    cumulativeText = ''
    captureDone = false
  }

  function extractFullText(data) {
    if (data.v?.response?.text) {
      const full = data.v.response.text
      if (full.length > cumulativeText.length) {
        cumulativeText = full
        return full
      }
      return null
    }
    let delta = null
    if (data.v?.response?.choices?.[0]?.delta?.content) {
      delta = data.v.response.choices[0].delta.content
    } else if (data.choices?.[0]?.delta?.content) {
      delta = data.choices[0].delta.content
    } else if (data.choices?.[0]?.text) {
      delta = data.choices[0].text
    } else if (typeof data.content === 'string') {
      delta = data.content
    } else if ((data.type === 'text' || data.type === 'code') && data.content) {
      delta = data.content
    } else if (data.delta?.content) {
      delta = data.delta.content
    } else if (data.delta?.text) {
      delta = data.delta.text
    }
    if (delta) {
      cumulativeText += delta
      return cumulativeText
    }
    return null
  }

  function processSseLine(lineText) {
    if (!lineText || lineText === '[DONE]') return 'done'
    try {
      const data = JSON.parse(lineText)
      const fullText = extractFullText(data)
      if (fullText) {
        console.log('%c[NF_NET] SSE data: len=' + fullText.length + ' preview=' + fullText.slice(-50).replace(/\n/g, '\\n'), 'color: #ff6600; font-weight: bold')
        const taskId = window.__nf_currentTaskId
        if (taskId) {
          sendToCs('CHUNK', { content: fullText })
        }
        return 'ok'
      }
      return 'skip'
    } catch {
      return 'error'
    }
  }

  // 0. XHR 拦截（核心捕获路径——后台标签页中 DOM 读不到代码块，但 XHR 数据不受影响）
  var _nf_xhrOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    if (url && (typeof url === 'string') && (url.includes('chat') || url.includes('completion'))) {
      console.log('[NF_NET] XHR open: ' + method + ' ' + url)
      var xhr = this
      var pending = ''
      resetState()
      xhr.addEventListener('readystatechange', function () {
        try {
          console.log('[NF_NET] XHR readyState=' + xhr.readyState + ' responseText_len=' + (xhr.responseText || '').length)
          if (xhr.readyState === 3 || xhr.readyState === 4) {
            var text = xhr.responseText || ''
            if (text === pending) return
            var newData = text.slice(pending.length)
            pending = text
            var lastNewline = newData.lastIndexOf('\n')
            if (lastNewline === -1 && xhr.readyState !== 4) return
            var completeData = lastNewline >= 0 ? newData.slice(0, lastNewline) : newData
            if (lastNewline >= 0) {
              pending = text.slice(0, text.length - (newData.length - lastNewline - 1))
            } else {
              pending = text
            }
            var lines = completeData.split('\n')
            for (var i = 0; i < lines.length; i++) {
              var trimmed = lines[i].trim()
              if (!trimmed) continue
              if (trimmed.startsWith('data: ')) {
                var d = trimmed.slice(6)
                if (d === '[DONE]') {
                  if (!captureDone) {
                    captureDone = true
                    console.log('[NF_NET] XHR DONE, total=' + cumulativeText.length)
                    sendToCs('DONE', {})
                  }
                } else {
                  var r = processSseLine(d)
                  if (r === 'ok') {
                    console.log('[NF_NET] XHR content sent, len=' + cumulativeText.length)
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('[NF_NET] XHR error:', e.message)
        }
      })
    }
    return _nf_xhrOpen.apply(this, arguments)
  }

  // 1. 主拦截器：ReadableStream.prototype.getReader
  var _nf_rsCounter = 0
  var _nf_origGetReader = ReadableStream.prototype.getReader
  ReadableStream.prototype.getReader = function (mode) {
    var reader = _nf_origGetReader.call(this, mode)
    var stream = this
    var _origRead = reader.read.bind(reader)
    var sniffed = stream.__nf_chatStream || false
    _nf_rsCounter++
    var rsId = _nf_rsCounter
    console.log('[NF_NET] RS#' + rsId + ' getReader called, locked=' + stream.locked)

    reader.read = async function () {
      var result = await _origRead()
      if (!result.value || result.done) return result

      try {
        var text = new TextDecoder().decode(result.value, { stream: true })
        if (text.trim().length > 0) {
          console.log('[NF_NET] RS#' + rsId + ' chunk: len=' + text.length + ' data=' + text.slice(0, 200).replace(/\n/g, '\\n'))
        }
        if (!sniffed) {
          if (text.includes('data: ') && (text.includes('"v"') || text.includes('choices') || text.includes('"role"'))) {
            sniffed = true
            stream.__nf_chatStream = true
            resetState()
            console.log('[NF_NET] RS#' + rsId + ' === STREAM DETECTED ===')
          }
        }
        if (sniffed || stream.__nf_chatStream) {
          var lines = text.split('\n')
          for (var i = 0; i < lines.length; i++) {
            var trimmed = lines[i].trim()
            if (trimmed.startsWith('data: ')) {
              var d = trimmed.slice(6)
              if (d === '[DONE]') {
                if (!captureDone) {
                  captureDone = true
                  console.log('[NF_NET] RS#' + rsId + ' DONE, total=' + cumulativeText.length)
                  sendToCs('DONE', {})
                }
              } else {
                var r = processSseLine(d)
                if (r === 'ok') {
                  console.log('[NF_NET] RS#' + rsId + ' content sent, cumulativeLen=' + cumulativeText.length)
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('[NF_NET] RS#' + rsId + ' error:', e.message)
      }
      return result
    }.bind(reader)
    return reader
  }

  // 2. 备用拦截器：window.fetch
  var _nf_origFetch = window.fetch
  window.fetch = new Proxy(_nf_origFetch, {
    apply: function (target, ctx, args) {
      var url = typeof args[0] === 'string' ? args[0] : args[0]?.url || ''
      var isCompletion = url.includes('chat') || url.includes('completion')
      if (!isCompletion) return target.apply(ctx, args)

      console.log('[NF_NET] FETCH called: ' + url)
      var result = target.apply(ctx, args)
      result.then(function (res) {
        if (!res.body || !res.ok || res.__nf_intercepted) return res
        res.__nf_intercepted = true
        if (!res.body.locked) {
          resetState()
          console.log('[NF_NET] FETCH tee: ' + url)
          try {
            var tee = res.body.tee()
            var forUs = tee[0], forPage = tee[1]
              ; (async function () {
                var reader = forUs.getReader()
                var dec = new TextDecoder()
                var buf = ''
                try {
                  while (true) {
                    var rd = await reader.read()
                    if (rd.done) break
                    buf += dec.decode(rd.value, { stream: true })
                    while (buf.includes('\n')) {
                      var idx = buf.indexOf('\n')
                      var line = buf.slice(0, idx).trim()
                      buf = buf.slice(idx + 1)
                      if (line.startsWith('data: ')) {
                        var d = line.slice(6)
                        if (d === '[DONE]') {
                          if (!captureDone) { captureDone = true; sendToCs('DONE', {}) }
                        } else {
                          processSseLine(d)
                        }
                      }
                    }
                  }
                  if (!captureDone) { captureDone = true; sendToCs('DONE', {}) }
                } catch (e) {
                  if (!captureDone) { captureDone = true; sendToCs('DONE', {}) }
                }
              })()
            return new Response(forPage, { status: res.status, statusText: res.statusText, headers: res.headers })
          } catch (e) {
            return res
          }
        } else {
          console.log('[NF_NET] FETCH body already locked: ' + url)
          return res
        }
      })
      return result
    }
  })

  console.log('[NF_NET] Persistent interceptors installed (ReadableStream + fetch + XHR)')
}

// ---- 轮询兜底：SSE 流在后台标签页会被节流断开，轮询不受影响 ----
let pollTimer = null
let pollActive = false

async function startPolling() {
  if (pollActive) return
  pollActive = true
  console.log('[NF_BG] POLL: Starting task polling (every 3s)')
  pollTimer = setInterval(pollForTasks, 3000)
}

async function pollForTasks() {
  const token = await getToken()
  if (!token) return
  try {
    // 如果有活跃任务，检查是否有待执行的 action
    if (currentTaskId) {
      const actRes = await fetch(`${API_BASE}/free-deepseek/extension-chat/${currentTaskId}/action`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (actRes.ok) {
        const actData = await actRes.json()
        if (actData.action) {
          console.log('[NF_BG] ACTION:', actData.action, 'for task', currentTaskId)
          await executeDsAction(actData.action)
        }
      }
      return
    }
    const res = await fetch(`${API_BASE}/free-deepseek/extension-chat/poll`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!res.ok) return
    const data = await res.json()
    if (data.task_id) {
      console.log('[NF_BG] POLL: Got task', data.task_id)
      await handleTask(data, token)
    }
  } catch (e) {
    // 静默失败，下次重试
  }
}

async function executeDsAction(action) {
  const dsTabs = await chrome.tabs.query({ url: 'https://chat.deepseek.com/*' })
  if (!dsTabs.length) return
  const tabId = dsTabs[0].id
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: function (actionType) {
        // 点击"继续生成"按钮
        if (actionType === 'continue') {
          var buttons = document.querySelectorAll('button')
          for (var i = 0; i < buttons.length; i++) {
            var txt = (buttons[i].textContent || '').trim()
            if (txt.includes('继续生成') || txt.includes('Continue')) {
              buttons[i].click()
              console.log('[NF_ACTION] Clicked continue button')
              return
            }
          }
          console.log('[NF_ACTION] Continue button not found')
        }
        // 点击"停止"按钮（发送按钮在生成时变为停止）
        if (actionType === 'stop') {
          var buttons = document.querySelectorAll('button')
          for (var i = 0; i < buttons.length; i++) {
            var txt = (buttons[i].textContent || '').trim()
            if (txt === '停止' || txt === 'Stop') {
              buttons[i].click()
              console.log('[NF_ACTION] Clicked stop button')
              return
            }
          }
          // 尝试点击发送按钮（生成时它就是停止按钮）
          var sendBtn = document.querySelector('[class*="stop" i], [data-testid*="stop"]')
          if (sendBtn) {
            sendBtn.click()
            console.log('[NF_ACTION] Clicked stop via selector')
            return
          }
          console.log('[NF_ACTION] Stop button not found')
        }
      },
      args: [action]
    })
  } catch (e) {
    console.warn('[NF_BG] executeDsAction error:', e.message)
  }
}

async function sendHeartbeat() {
  const token = await getToken()
  if (!token) return
  try {
    await fetch(`${API_BASE}/free-deepseek/extension-heartbeat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    })
    lastHeartbeat = Date.now()
    console.log('[NF_BG] Heartbeat sent on tab visible')
  } catch (e) {
    console.warn('[NF_BG] Heartbeat failed:', e.message)
  }
}

const NF_URLS = ['http://localhost:5173/*', 'http://localhost:5174/*']

async function detectNfFrontend() {
  for (const url of NF_URLS) {
    const tabs = await chrome.tabs.query({ url })
    console.log('[NF_BG] INIT: NF frontend tabs found for', url, ':', tabs.length)
    if (tabs.length > 0) {
      connectSse()
      return
    }
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.url && NF_URLS.some(pattern => tab.url.startsWith(pattern.replace('/*', '')))) {
    console.log('[NF_BG] TAB: NF frontend opened, connecting SSE')
    connectSse()
  }
  // DS 标签页加载完成时 — interceptor.js 已在 manifest 中配置 document_start，无需手动安装
})

chrome.tabs.onRemoved.addListener((tabId) => {
  _deepseekTabIds.delete(tabId)
})

async function connectSse() {
  if (sseConnected) return
  sseConnected = true
  sseLastError = null

  const token = await getToken()
  if (!token) {
    sseConnected = false
    sseLastError = '未登录'
    console.log('[NF_BG] SSE: No token, retry in 2s')
    setTimeout(connectSse, 2000)
    return
  }

  console.log('[NF_BG] SSE: Connecting with fetch streaming...')
  const connectTime = Date.now()

  try {
    const response = await fetch(`${API_BASE}/free-deepseek/extension-chat/stream`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (!response.ok) {
      console.log('[NF_BG] SSE: Connection failed (status=' + response.status + '), retry in 3s')
      sseConnected = false
      sseLastError = `连接失败 (${response.status})`
      setTimeout(connectSse, 3000)
      return
    }

    console.log('[NF_BG] SSE: Connected OK, elapsed=' + (Date.now() - connectTime) + 'ms')
    lastHeartbeat = Date.now()

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let readCount = 0
    let lastReadTime = Date.now()

    while (true) {
      const now = Date.now()
      const timeSinceLastRead = now - lastReadTime
      readCount++

      if (readCount % 100 === 0 || timeSinceLastRead > 10000) {
        console.log('[NF_BG] SSE: read #' + readCount + ', timeSinceLastRead=' + timeSinceLastRead + 'ms')
      }
      lastReadTime = now

      const { done, value } = await reader.read()
      if (done) {
        console.log('[NF_BG] SSE: Stream ended after ' + readCount + ' reads, totalDuration=' + (now - connectTime) + 'ms')
        break
      }

      lastHeartbeat = Date.now()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6)
          if (dataStr === ': keepalive') {
            lastHeartbeat = Date.now()
            continue
          }
          try {
            const data = JSON.parse(dataStr)
            console.log('[NF_BG] SSE: Received task data, task_id=' + data.task_id)
            await handleTask(data, token)
          } catch (e) {
            console.warn('[NF_BG] SSE: Parse error:', e.message, 'data:', dataStr.slice(0, 100))
          }
        }
      }
    }
  } catch (e) {
    console.log('[NF_BG] SSE: Stream error after ' + (Date.now() - connectTime) + 'ms:', e.message)
    sseLastError = e.message
  }

  console.log('[NF_BG] SSE: Stream ended, reconnecting in 3s...')
  sseConnected = false
  setTimeout(connectSse, 3000)
}

async function handleTask(data, token) {
  if (!data.task_id) return

  console.log('[NF_BG] SSE: GOT TASK ========================================')
  console.log('[NF_BG] SSE:   taskId     =', data.task_id)
  currentTaskId = data.task_id
  currentTaskStartTime = Date.now()

  const messages = data.messages || []
  const contextTxt = data.context_txt || ''
  const userMessage = messages[messages.length - 1]?.content || ''
  console.log('[NF_BG] SSE:   userMsg    =', userMessage.slice(0, 100))
  console.log('[NF_BG] SSE:   contextLen =', contextTxt.length)
  console.log('[NF_BG] SSE:   msgCount   =', messages.length)

  const dsTabs = await chrome.tabs.query({ url: 'https://chat.deepseek.com/*' })
  if (!dsTabs.length) {
    console.log('[NF_BG] SSE: No DeepSeek tab')
    _deepseekTabIds.clear()
    await fetch(`${API_BASE}/free-deepseek/extension-chat/${data.task_id}/error`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '请先打开 chat.deepseek.com 并登录' })
    })
    currentTaskId = null
    currentTaskStartTime = 0
    return
  }

  _deepseekTabIds.clear()
  dsTabs.forEach(t => _deepseekTabIds.add(t.id))
  console.log('[NF_BG] SSE:   userMessage  =', userMessage.slice(0, 80))
  console.log('[NF_BG] SSE:   contextTxt   =', contextTxt ? contextTxt.slice(0, 80) + '...' : '(empty)')

  // 确保 DS 页面上已安装持久化网络拦截器
  const targetTabId = dsTabs[0].id
  // installInterceptorOnTab 禁用 — interceptor.js 已在 document_start 安装

  // 如果是继续生成任务，直接点击 DS 的"继续生成"按钮
  if (data.is_continue) {
    console.log('[NF_BG] SSE: Continue task, clicking DS continue button')
    await executeDsAction('continue')
    return
  }

  // 先通知 content script 设置当前任务 ID（inject.js 在隔离 world，读不到 MAIN world 的变量）
  try {
    await chrome.tabs.sendMessage(targetTabId, { type: 'SET_TASK_ID', taskId: data.task_id })
    console.log('[NF_BG] SSE: Sent SET_TASK_ID to content script, taskId=' + data.task_id)
  } catch (e) {
    console.warn('[NF_BG] SSE: Failed to send SET_TASK_ID:', e.message)
  }

  // chrome.scripting.executeScript 绕过 CSP，重试 3 次
  let injected = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log('[NF_BG] SSE: Injecting into tab', targetTabId, '(attempt', attempt, ')')
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        world: 'MAIN',
        func: injectedTriggerHandler,
        args: [data.task_id, userMessage, contextTxt]
      })
      injected = true
      console.log('[NF_BG] SSE: Injected OK')
      break
    } catch (e) {
      console.warn('[NF_BG] SSE: Injection attempt', attempt, 'failed:', e.message)
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500))
    }
  }
  if (!injected) {
    console.error('[NF_BG] SSE: All injection attempts failed')
    await fetch(`${API_BASE}/free-deepseek/extension-chat/${data.task_id}/error`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '无法连接到 DeepSeek 页面。请确保 DS 页面与本网页在同一浏览器中，且页面已加载完成' })
    })
    currentTaskId = null
    currentTaskStartTime = 0
  }
}


// 启动核心服务
startChatListening()
startDsNetworkInterceptor()

// ========== 核心注入：TXT 文件上传 + 自动点击发送 + 回复捕获 ==========
async function injectedTriggerHandler(taskId, userMessage, contextTxt) {
  const INPUT_SEL = 'textarea, [contenteditable="true"]'

  function log(msg, ...args) {
    try { console.log('[NF_TRIG] ' + msg, ...args) } catch (e) { }
  }
  function sendToBg(type, data) {
    try {
      // 永远阻止 DOM 捕获发送 DS_DONE（拦截器的 net_DONE 唯一控制结束）
      if (type === 'DS_DONE') {
        log('sendToBg: Blocked DS_DONE (let interceptor control)')
        return
      }
      const msg = { source: 'nf-main-world', type, taskId, ...data }
      // log('sendToBg:', type, 'content_len=' + (data?.content?.length || 0))
      window.postMessage(msg, '*')
      if (type === 'DS_ERROR') clearTaskId()
    } catch (e) {
      log('sendToBg ERROR:', e.message)
    }
  }

  // ============ 持久拦截器已由 background.js 在标签页初始化时安装 ============
  // 网络拦截（ReadableStream + fetch）通过 chrome.scripting.executeScript({ world: 'MAIN' })
  // 在 MAIN world 中持久运行，绕过 CSP。
  // 数据通过 window.postMessage → inject.js bridge → background 转发。
  // 这里只需设置当前任务 ID，持久拦截器会自动关联后续捕获的 SSE 内容。
  try {
    window.__nf_currentTaskId = taskId
    log('__nf_currentTaskId set to: ' + taskId)
    // 通知 content script 当前任务 ID（inject.js 在隔离 world，读不到 MAIN world 的变量）
    window.postMessage({ source: 'nf-main-world', type: 'net_TASK_START', taskId: taskId }, '*')
    log('Posted net_TASK_START to content script')
  } catch (e) {
    log('Failed to set __nf_currentTaskId:', e.message)
  }

  // 清理 __nf_currentTaskId 的函数
  function clearTaskId() {
    try { window.__nf_currentTaskId = null } catch (e) { }
  }

  log('========================================')
  log('taskId       =', taskId)
  log('userMessage  =', userMessage.slice(0, 100))
  log('userMsgLen   =', userMessage.length)
  log('contextLen   =', (contextTxt || '').length)

  // ============ STEP 0.5: 上传 TXT 文件（当有项目设定时） ============
  let hasFileUpload = false
  if (contextTxt && contextTxt.trim().length > 0) {
    log('STEP 0.5: Creating TXT with project context + user message...')
    try {
      const txtContent = contextTxt + '\n\n---\n\n用户提问：' + userMessage
      log('  TXT total length:', txtContent.length)

      const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' })
      const file = new File([blob], 'novel_context.txt', { type: 'text/plain' })
      const dt = new DataTransfer()
      dt.items.add(file)

      let fileInput = document.querySelector('input[type="file"]')
      if (!fileInput) {
        fileInput = document.createElement('input')
        fileInput.type = 'file'
        fileInput.accept = '.txt,.md,.pdf,.doc,.docx'
        fileInput.style.cssText = 'position:fixed;top:-100px;left:-100px;width:1px;height:1px;opacity:0'
        document.body.appendChild(fileInput)
      }

      try {
        fileInput.files = dt.files
      } catch (e) {
        Object.defineProperty(fileInput, 'files', { value: dt.files })
      }
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      hasFileUpload = true
      log('STEP 0.5: TXT file uploaded to input[type="file"]')
    } catch (e) {
      log('STEP 0.5: TXT upload failed:', e.message)
      hasFileUpload = false
    }
  } else {
    log('STEP 0.5: No context, skipping TXT file upload')
  }

  // ============ STEP 1: 找输入框 ============
  log('STEP 1: Looking for input element')
  const input = document.querySelector(INPUT_SEL)
  if (!input) {
    log('STEP 1 FAILED: Input not found')
    sendToBg('DS_ERROR', { error: '找不到 DeepSeek 输入框' })
    return
  }
  log('STEP 1: Input found:', input.tagName)

  // ============ STEP 2: 清空输入框并填入用户消息 ============
  function triggerReactInput(el, value) {
    try {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        nativeSetter.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      } else if (el.isContentEditable) {
        el.textContent = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('textInput', { bubbles: true }))
      }
      const reactKey = Object.keys(el).find(k => k.startsWith('__reactProps'))
      if (reactKey && el[reactKey]?.onChange) {
        el[reactKey].onChange({ target: el, currentTarget: el })
      }
    } catch (e) {
      log('  triggerReactInput failed:', e.message)
    }
  }

  log('STEP 2: Clearing input first...')
  try {
    input.focus()
    input.select()
    triggerReactInput(input, '')
    await new Promise(r => setTimeout(r, 100))
  } catch (e) {
    log('STEP 2: Clear failed:', e.message)
  }

  log('STEP 2: Filling input with user message (len=' + userMessage.length + ')')
  try {
    triggerReactInput(input, userMessage)
    log('STEP 2: value set, length:', input.value?.length || 0, 'preview:', (input.value || '').slice(0, 40))
  } catch (e) {
    log('STEP 2 FAILED:', e.message)
    sendToBg('DS_ERROR', { error: '填充输入框失败: ' + e.message })
    return
  }

  // ============ 状态提示 UI ============
  function showStatus(msg) {
    let tip = document.getElementById('nf-send-status')
    if (!tip) {
      tip = document.createElement('div')
      tip.id = 'nf-send-status'
      tip.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;background:#1a1a2e;color:#00d4ff;padding:12px 20px;border-radius:8px;font-size:14px;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;max-width:320px;'
      document.body.appendChild(tip)
    }
    tip.textContent = '[NovelForge] ' + msg
    tip.style.opacity = '1'
    return tip
  }

  function removeStatus() {
    const tip = document.getElementById('nf-send-status')
    if (tip) {
      tip.style.opacity = '0'
      setTimeout(() => tip.remove(), 300)
    }
  }

  // ============ STEP 3: 发送消息（优先 Enter 键，兜底按钮点击） ============
  log('STEP 3: Starting send... (hasFileUpload=' + hasFileUpload + ')')

  function isNfElement(el) {
    return el.closest && (el.closest('#nf-panel') || el.closest('#nf-fab') || el.closest('[class*="nf-"]'))
  }

  function isVisible(el) {
    return el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0
  }

  function isClickable(el) {
    const ariaDisabled = el.getAttribute('aria-disabled')
    if (ariaDisabled === 'true') return false
    if (el.disabled) return false
    const style = window.getComputedStyle(el)
    if (style.pointerEvents === 'none' || style.opacity === '0') return false
    return true
  }

  function simulateFullClick(btn) {
    const rect = btn.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  }

  function tryClickButton() {
    const freshInput = document.querySelector(INPUT_SEL)
    if (!freshInput) return false

    function isUploadButton(btn) {
      const text = (btn.textContent || '').trim().toLowerCase()
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase()
      const title = (btn.getAttribute('title') || '').toLowerCase()
      const cls = (btn.className || '').toLowerCase()
      const svgPath = btn.querySelector('svg path')
      const svgD = svgPath ? (svgPath.getAttribute('d') || '') : ''
      if (text.includes('upload') || text.includes('附件') || text.includes('上传')) return true
      if (ariaLabel.includes('upload') || ariaLabel.includes('attach') || ariaLabel.includes('file')) return true
      if (title.includes('upload') || title.includes('attach') || title.includes('file')) return true
      if (cls.includes('upload') || cls.includes('attach')) return true
      const icon = btn.querySelector('svg, [class*="icon"]')
      if (icon) {
        const iconCls = (icon.className || '').toLowerCase()
        if (iconCls.includes('upload') || iconCls.includes('attach') || iconCls.includes('paperclip')) return true
      }
      const inputForFile = btn.querySelector('input[type="file"]') || btn.parentElement?.querySelector('input[type="file"]')
      if (inputForFile) return true
      return false
    }

    let el = freshInput.parentElement
    for (let depth = 0; depth < 10 && el; depth++) {
      const btns = el.querySelectorAll('[role="button"]')
      for (let j = btns.length - 1; j >= 0; j--) {
        const btn = btns[j]
        if (isVisible(btn) && !isNfElement(btn) && isClickable(btn) && !isUploadButton(btn)) {
          log('  >>> CLICK [role="button"] at depth', depth, ':', (btn.className || '').slice(0, 40))
          simulateFullClick(btn)
          btn.click()
          return true
        }
      }
      el = el.parentElement
    }

    const allBtns = document.querySelectorAll('.ds-icon-button[role="button"]')
    for (let i = allBtns.length - 1; i >= 0; i--) {
      const btn = allBtns[i]
      if (isVisible(btn) && !isNfElement(btn) && isClickable(btn) && !isUploadButton(btn)) {
        const btnRect = btn.getBoundingClientRect()
        const inputRect = freshInput.getBoundingClientRect()
        const distance = Math.abs(btnRect.top - inputRect.top)
        if (distance < 300) {
          log('  >>> CLICK ds-icon-button near input, distance=' + distance + 'px')
          simulateFullClick(btn)
          btn.click()
          return true
        }
      }
    }

    const fallbackBtns = document.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])')
    for (let i = fallbackBtns.length - 1; i >= 0; i--) {
      const btn = fallbackBtns[i]
      if (!isVisible(btn) || isNfElement(btn) || isUploadButton(btn)) continue
      const btnRect = btn.getBoundingClientRect()
      const inputRect = freshInput.getBoundingClientRect()
      if (Math.abs(btnRect.top - inputRect.top) < 400 && Math.abs(btnRect.right - inputRect.right) < 200) {
        log('  >>> CLICK fallback button near input, text=' + (btn.textContent || '').trim().slice(0, 20))
        btn.click()
        return true
      }
    }

    return false
  }

  function pressEnter() {
    const freshInput = document.querySelector(INPUT_SEL)
    if (!freshInput) return false

    log('  >>> Pressing Enter key via React onKeyDown only')
    freshInput.focus()

    try {
      const reactKey = Object.keys(freshInput).find(k => k.startsWith('__reactProps'))
      if (reactKey && freshInput[reactKey]?.onKeyDown) {
        freshInput[reactKey].onKeyDown({
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
          nativeEvent: { isComposing: false },
          preventDefault: () => { },
          stopPropagation: () => { },
          target: freshInput, currentTarget: freshInput
        })
        log('  >>> React onKeyDown(Enter) called')
        return true
      }
    } catch (e) {
      log('  >>> React onKeyDown failed:', e.message)
    }

    log('  >>> React onKeyDown not found, using native')
    freshInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }))
    return true
  }

  if (hasFileUpload) {
    showStatus('文件已上传，等待 DeepSeek 处理...')
    log('STEP 3: File uploaded, waiting for DS to process, then sending...')

    let sent = false
    const POLL_START = Date.now()
    const MAX_POLL_MS = 30000

    while (Date.now() - POLL_START < MAX_POLL_MS) {
      const fi = document.querySelector(INPUT_SEL)
      if (!fi) {
        await new Promise(r => setTimeout(r, 500))
        continue
      }

      const currentVal = (fi.value || fi.textContent || '').trim()

      if (!currentVal) {
        fi.focus()
        triggerReactInput(fi, userMessage)
        await new Promise(r => setTimeout(r, 300))
      }

      const elapsed = Date.now() - POLL_START
      if (elapsed < 2000) {
        await new Promise(r => setTimeout(r, 500))
        continue
      }

      if (pressEnter()) {
        await new Promise(r => setTimeout(r, 600))
        const inputAfter = document.querySelector(INPUT_SEL)
        const inputEmpty = !inputAfter || !(inputAfter.value || inputAfter.textContent || '').trim()
        if (inputEmpty) {
          sent = true
          log('STEP 3: Sent via Enter, elapsed=' + (Date.now() - POLL_START) + 'ms')
          break
        }
      }

      if (!sent && elapsed > 4000) {
        if (tryClickButton()) {
          await new Promise(r => setTimeout(r, 600))
          const inputAfter = document.querySelector(INPUT_SEL)
          const inputEmpty = !inputAfter || !(inputAfter.value || inputAfter.textContent || '').trim()
          if (inputEmpty) {
            sent = true
            log('STEP 3: Sent via button click, elapsed=' + (Date.now() - POLL_START) + 'ms')
            break
          }
        }
      }

      await new Promise(r => setTimeout(r, 800))
    }

    if (!sent) {
      log('STEP 3: Poll exhausted, final send attempt...')
      const fi = document.querySelector(INPUT_SEL)
      if (fi) {
        fi.focus()
        fi.click()
        triggerReactInput(fi, userMessage)
      }
      pressEnter()
      await new Promise(r => setTimeout(r, 600))
      const inputAfter = document.querySelector(INPUT_SEL)
      if (!inputAfter || !(inputAfter.value || inputAfter.textContent || '').trim()) {
        sent = true
        log('STEP 3: Sent via final attempt')
      } else {
        log('STEP 3: Final attempt may have failed, input still has content')
      }
    }
  } else {
    showStatus('正在发送消息...')
    log('STEP 3: No file upload, pressing Enter...')
    const sendInput = document.querySelector(INPUT_SEL)
    if (sendInput) {
      sendInput.focus()
      sendInput.click()
    }
    pressEnter()
    await new Promise(r => setTimeout(r, 500))
  }

  showStatus('消息已发送，等待 DeepSeek 回复...')

  // ============ HTML → Markdown 转换器 ============
  function htmlToMarkdown(el) {
    if (!el) return ''
    const clone = el.cloneNode(true)

    // 移除代码块头部的 UI 按钮（语言标签、复制、下载、运行）
    clone.querySelectorAll('.code-block-header, [class*="code-header"], [class*="code-block"] > div:first-child').forEach(h => {
      const text = (h.textContent || '').trim()
      // 如果是代码块头部（包含语言名或操作按钮），移除
      if (/^(javascript|python|css|html|markdown|json|java|c\+\+|rust|go|bash|sql|typescript|ruby|php|swift|kotlin)/i.test(text) ||
        text.includes('复制') || text.includes('下载') || text.includes('运行') || text.includes('Copy') || text.includes('Download')) {
        h.remove()
      }
    })

    function nodeToMd(node) {
      if (node.nodeType === 3) return node.textContent || ''
      if (node.nodeType !== 1) return ''
      const tag = node.tagName
      const children = Array.from(node.childNodes).map(nodeToMd).join('')

      if (tag === 'H1') return '# ' + children.trim() + '\n\n'
      if (tag === 'H2') return '## ' + children.trim() + '\n\n'
      if (tag === 'H3') return '### ' + children.trim() + '\n\n'
      if (tag === 'H4') return '#### ' + children.trim() + '\n\n'
      if (tag === 'H5') return '##### ' + children.trim() + '\n\n'
      if (tag === 'H6') return '###### ' + children.trim() + '\n\n'
      if (tag === 'P') return children.trim() + '\n\n'
      if (tag === 'STRONG' || tag === 'B') return '**' + children.trim() + '**'
      if (tag === 'EM' || tag === 'I') return '*' + children.trim() + '*'
      if (tag === 'BR') return '\n'
      if (tag === 'HR') return '---\n\n'
      if (tag === 'A') {
        const href = node.getAttribute('href') || ''
        return '[' + children.trim() + '](' + href + ')'
      }
      if (tag === 'IMG') {
        const alt = node.getAttribute('alt') || ''
        const src = node.getAttribute('src') || ''
        return '![' + alt + '](' + src + ')'
      }
      if (tag === 'PRE') {
        const code = node.querySelector('code')
        const lang = (code?.className || '').replace('language-', '').replace('lang-', '')
        const text = (code || node).textContent || ''
        return '\n```' + lang + '\n' + text.trim() + '\n```\n\n'
      }
      if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') {
        return '`' + (node.textContent || '') + '`'
      }
      if (tag === 'BLOCKQUOTE') {
        return children.trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n'
      }
      if (tag === 'UL') {
        return Array.from(node.children).map(li => '- ' + nodeToMd(li).trim()).join('\n') + '\n\n'
      }
      if (tag === 'OL') {
        return Array.from(node.children).map((li, i) => (i + 1) + '. ' + nodeToMd(li).trim()).join('\n') + '\n\n'
      }
      if (tag === 'LI') return children
      if (tag === 'TABLE') {
        const rows = Array.from(node.querySelectorAll('tr'))
        if (rows.length === 0) return children
        const mdRows = rows.map(tr => {
          const cells = Array.from(tr.querySelectorAll('th, td')).map(c => c.textContent.trim())
          return '| ' + cells.join(' | ') + ' |'
        })
        if (mdRows.length > 1) {
          const colCount = (mdRows[0].match(/\|/g) || []).length - 1
          const sep = '|' + Array(colCount).fill('---').join('|') + '|'
          mdRows.splice(1, 0, sep)
        }
        return mdRows.join('\n') + '\n\n'
      }
      if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TR' || tag === 'TH' || tag === 'TD') return children
      if (tag === 'DIV' || tag === 'SPAN' || tag === 'SECTION' || tag === 'ARTICLE') return children
      return children
    }

    return nodeToMd(clone).replace(/\n{3,}/g, '\n\n').trim()
  }

  // ============ STEP 4: 捕获 DeepSeek 回复 ============
  log('STEP 4: Setting up response capture...')
  const ASSISTANT_SEL = '.ds-markdown.ds-assistant-message-main-content'
  const msgContainer = document.querySelector('.ds-virtual-list, .cb86951c') || document.body

  // DeepSeek 二次审核过滤检测
  const FILTER_MESSAGES = [
    '你好，这个问题我暂时无法回答',
    'Sorry, I cannot answer this question',
    '抱歉，我无法回答这个问题',
    '我无法回答这个问题，让我们换个话题',
  ]
  const FILTER_MIN_ORIGINAL_LEN = 50 // 原内容超过此长度才触发回退

  function isFilterReplacement(newContent, prevContent) {
    const trimmed = newContent.trim()
    // 新内容很短且包含已知过滤话术
    if (trimmed.length > 200) return false
    const lower = trimmed.toLowerCase()
    return FILTER_MESSAGES.some(fm => lower.includes(fm.toLowerCase()))
      && prevContent.trim().length > FILTER_MIN_ORIGINAL_LEN
  }

  const knownContents = new Set()
  document.querySelectorAll(ASSISTANT_SEL).forEach(el => {
    const text = (el.textContent || '').trim()
    if (text.length > 0) {
      knownContents.add(text.slice(0, 100))
    }
  })
  log('STEP 4: Recorded', knownContents.size, 'known reply contents')

  let targetEl = null
  let contentObserver = null
  let stableTimer = null
  let maxWaitTimer = null
  let maxWaitPoll = null
  let rafLoopId = 0
  let contentPollId = null
  let isDone = false
  let chunkCount = 0
  let lastCapturedPrefix = ''

  const MIN_RESPONSE_LENGTH = 1
  function getStableTimeout() { return 1000 }

  // 检测文本中是否有未闭合的代码围栏
  function hasUnclosedCodeFence(text) {
    if (!text || !text.includes('```')) return false
    const lines = text.split('\n')
    let fenceCount = 0
    // 在 markdown 中，每对 ``` 围栏应该有一个语言标签紧随其后
    // 我们把以 ``` 开头的行作为围栏计数
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('```')) fenceCount++
    }
    // 奇数个围栏 = 未闭合
    return fenceCount % 2 !== 0
  }

  // 标签页切回前台时立即触发一次内容检查
  let _visibilityCheckFn = null
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && _visibilityCheckFn && !isDone) {
      // log('STEP 4: Tab became visible, immediate check')
      _visibilityCheckFn()
    }
  })

  function isNewContent(el) {
    const text = (el.textContent || '').trim()
    if (text.length === 0) return false
    const prefix = text.slice(0, 100)
    return !knownContents.has(prefix)
  }

  function cleanupWatchers() {
    if (contentObserver) { contentObserver.disconnect(); contentObserver = null }
    if (stableTimer) { clearTimeout(stableTimer); stableTimer = null }
    if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null }
    if (maxWaitPoll) { clearInterval(maxWaitPoll); maxWaitPoll = null }
    if (rafLoopId) { cancelAnimationFrame(rafLoopId); rafLoopId = 0 }
    if (contentPollId) { clearInterval(contentPollId); contentPollId = null }
  }

  function watchElement(el) {
    cleanupWatchers()
    targetEl = el
    const initialText = (el.textContent || '').trim()
    knownContents.add(initialText.slice(0, 100))
    let lastContent = ''
    let lastValidContent = ''  // 保存过滤前的最后有效内容
    let firstChunkSent = false
    let filterDetected = false
    let lastRawText = '' // 用 textContent 做变化检测（不依赖布局，后台标签页也可靠）
    let deferredForCode = false  // 防止 checkDsFinished 重复触发已延期的 finishCapture
    // log('STEP 4: Watching NEW element, initial length=' + initialText.length)

    function checkContent() {
      if (isDone) return
      if (!targetEl) { log('STEP 4: checkContent skipped, no targetEl'); return }
      if (!targetEl.isConnected) { log('STEP 4: checkContent skipped, targetEl disconnected'); return }

      // 用 textContent 检测变化（不依赖布局，后台标签页也能拿到最新内容）
      // 再用 innerText 强制 reflow 供 htmlToMarkdown 读取最新渲染结构
      let rawText = (targetEl.textContent || '').trim()

      // 额外检查代码块 pre 元素的 textContent（内层嵌套深，textContent 保障后台页也能读取）
      const codePres = targetEl.querySelectorAll('.md-code-block pre, pre')
      for (const pre of codePres) {
        const codeText = (pre.textContent || '').trim()
        if (codeText && !rawText.includes(codeText)) {
          rawText += '\n```\n' + codeText + '\n```'
        }
      }

      if (rawText === lastRawText) return
      // log('STEP 4: textContent changed: ' + lastRawText.length + ' → ' + rawText.length)
      lastRawText = rawText

      // 强制读取 innerText 触发 reflow，确保 htmlToMarkdown 读取到最新渲染结构
      const _reflow = targetEl.innerText

      const content = htmlToMarkdown(targetEl)

      if (content === lastContent) {
        log('STEP 4: htmlToMarkdown unchanged (len=' + content.length + '), skipping send')
        return
      }

      const stripped = content.replace(/```/g, '').trim()
      if (stripped.length === 0) return

      // log('STEP 4: checkContent NEW content len=' + content.length + ' lastLen=' + lastContent.length + ' preview=' + content.slice(0, 40))

      // 检测 DeepSeek 二次审核过滤：用有效内容替换过滤文本
      if (!filterDetected && lastValidContent && isFilterReplacement(content, lastValidContent)) {
        log('STEP 4: FILTER DETECTED! Content was censored. Restoring last valid content (len=' + lastValidContent.length + ')')
        filterDetected = true
        chunkCount++
        sendToBg('DS_CHUNK', { content: lastValidContent, filtered: true })
        lastContent = content
        return
      }

      chunkCount++
      sendToBg('DS_CHUNK', { content: content })
      lastContent = content
      if (!filterDetected) lastValidContent = content
      if (!firstChunkSent) firstChunkSent = true
      deferredForCode = false  // 新内容到达，重置延迟标志

      // 只在内容真正变化时重置定时器
      clearTimeout(stableTimer)
      clearTimeout(maxWaitTimer)
      // 停止按钮可见 = DS 仍在生成，需要等它完成才宣布 DONE
      const genActive = document.querySelector('[class*="stop" i], [aria-label*="stop" i], [data-testid*="stop" i]')
      const extended = hasUnclosedCodeFence(content) || genActive
      const stableTimeout = extended ? 5000 : getStableTimeout()
      const maxTimeout = extended ? 25000 : 8000
      if (extended) {
        log('STEP 4: Extended timeout=' + stableTimeout + 'ms (unclosedFence=' + hasUnclosedCodeFence(content) + ', genActive=' + !!genActive + ')')
      }
      stableTimer = setTimeout(finishCapture, stableTimeout)
      maxWaitTimer = setTimeout(finishCapture, maxTimeout)
    }

    function finishCapture() {
      log('STEP 4: finishCapture called, isDone=' + isDone + ' targetEl=' + !!targetEl + ' connected=' + targetEl?.isConnected + ' chunks=' + chunkCount)
      if (isDone) return
      // 如果拦截器已经发送过数据，不要发 DS_DONE（让拦截器控制结束）
      // 也不要停止观察者 —— DS 可能只是暂停（token 超限），用户点击继续后需要继续捕获
      if (window.__nf_interceptorSent) {
        log('STEP 4: Interceptor active, skipping DOM DS_DONE, keeping watchers alive')
        // 不设置 isDone，不 cleanupWatchers，让观察者继续运行
        // 拦截器会通过 ds_state 信号控制生命周期
        return
      }
      if (!targetEl && chunkCount > 0) {
        log('STEP 4: DONE (targetEl was reset, but chunks were sent)')
        isDone = true
        removeStatus()
        cleanupWatchers()
        childObserver.disconnect()
        clearInterval(pollInterval)
        clearInterval(maxWaitPoll)
        _visibilityCheckFn = null
        sendToBg('DS_DONE', {})
        return
      }
      if (!targetEl) return
      const currentContent = htmlToMarkdown(targetEl).trim()
      const currentLen = currentContent.length
      if (currentLen < MIN_RESPONSE_LENGTH) {
        log('STEP 4: Content too short (' + currentLen + ' < ' + MIN_RESPONSE_LENGTH + '), ignoring')
        knownContents.add((targetEl.textContent || '').trim().slice(0, 100))
        cleanupWatchers()
        targetEl = null
        _visibilityCheckFn = null
        return
      }
      // 如果内容含未闭合的代码围栏，推迟完成（代码块渲染尚未完成）
      if (hasUnclosedCodeFence(currentContent)) {
        log('STEP 4: finishCapture deferred - unclosed code fence detected, rechecking later')
        deferredForCode = true
        clearTimeout(stableTimer)
        clearTimeout(maxWaitTimer)
        stableTimer = setTimeout(finishCapture, 3000)
        maxWaitTimer = setTimeout(finishCapture, 25000)
        return
      }
      // DeepSeek 停止按钮可见，说明仍在生成中，推迟完成
      const genActive = document.querySelector('[class*="stop" i], [aria-label*="stop" i], [data-testid*="stop" i]')
      if (genActive) {
        log('STEP 4: finishCapture deferred - stop button visible (DS still generating)')
        deferredForCode = true
        clearTimeout(stableTimer)
        clearTimeout(maxWaitTimer)
        stableTimer = setTimeout(finishCapture, 2000)
        maxWaitTimer = setTimeout(finishCapture, 15000)
        return
      }
      deferredForCode = false
      log('STEP 4: DONE (chunks=' + chunkCount + ', length=' + currentLen + ')')
      isDone = true
      removeStatus()
      cleanupWatchers()
      childObserver.disconnect()
      clearInterval(pollInterval)
      clearInterval(maxWaitPoll)
      _visibilityCheckFn = null
      sendToBg('DS_DONE', {})
    }

    // 检测 DeepSeek 回复完成（停止按钮消失 / 发送按钮恢复可用）
    let lastCheckTime = 0
    function checkDsFinished() {
      if (isDone || !firstChunkSent) return
      // 被 finishCapture defer 了代码围栏，不跳过（围栏闭合后应继续）
      // 但如果只是 stop 按钮 defer，现在 stop 按钮消失了 → rescue
      if (deferredForCode) {
        const genActive = document.querySelector('[class*="stop" i], [aria-label*="stop" i], [data-testid*="stop" i]')
        if (!genActive && !hasUnclosedCodeFence(htmlToMarkdown(targetEl).trim())) {
          deferredForCode = false
          log('STEP 4: checkDsFinished rescued - stop button disappeared')
        } else {
          return
        }
      }
      const now = Date.now()
      if (now - lastCheckTime < 200) return // 每 200ms 检查一次
      lastCheckTime = now

      // 方式1：停止按钮消失 = 回复完成
      const stopBtn = document.querySelector('[class*="stop" i], [aria-label*="stop" i], [data-testid*="stop" i]')
      if (!stopBtn) {
        // 方式2：发送按钮恢复可用 = 回复完成
        const sendBtn = document.querySelector('[class*="send" i][role="button"], button[type="submit"]')
        if (sendBtn && !sendBtn.disabled && !sendBtn.getAttribute('aria-disabled')) {
          log('STEP 4: DS finished (send button enabled) → finishCapture')
          finishCapture()
          return
        }
      }
    }

    // 标签页切回前台时立即检查
    _visibilityCheckFn = () => { checkContent(); checkDsFinished() }

    contentObserver = new MutationObserver(() => {
      if (!isDone) { checkContent(); checkDsFinished() }
    })
    contentObserver.observe(el, { childList: true, subtree: true, characterData: true })

    // 10ms 轮询：MutationObserver 的可靠备份
    contentPollId = setInterval(() => {
      if (isDone) { clearInterval(contentPollId); return }
      checkContent()
      checkDsFinished()
    }, 10)

    // rAF 循环：前台时每帧检查（~16ms），比 setInterval 更快
    function rafLoop() {
      if (isDone) return
      checkContent()
      checkDsFinished()
      rafLoopId = requestAnimationFrame(rafLoop)
    }
    rafLoopId = requestAnimationFrame(rafLoop)

    // 立即检查
    checkContent()
  }

  const childObserver = new MutationObserver((mutations) => {
    if (targetEl && targetEl.isConnected) return
    // log('STEP 4: childObserver fired, targetEl connected=' + targetEl?.isConnected + ' mutations=' + mutations.length)
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue
        const found = node.matches?.(ASSISTANT_SEL) ? node : node.querySelector?.(ASSISTANT_SEL)
        if (found) {
          const text = (found.textContent || '').trim()
          // log('STEP 4: Found assistant element, text=' + text.slice(0, 40) + ' lastPrefix=' + lastCapturedPrefix.slice(0, 40))
          // 只跳过完全相同的已处理内容
          if (text && text.slice(0, 100) === lastCapturedPrefix) { log('STEP 4: Skipping same content'); continue }
          lastCapturedPrefix = text.slice(0, 100)
          watchElement(found)
          return
        }
      }
    }
    log('STEP 4: childObserver no matching element found')
  })
  childObserver.observe(msgContainer, { childList: true, subtree: true })

  const pollInterval = setInterval(() => {
    if (isDone) {
      clearInterval(pollInterval)
      return
    }
    if (targetEl && targetEl.isConnected) return
    const all = document.querySelectorAll(ASSISTANT_SEL)
    for (const el of all) {
      if (isNewContent(el)) {
        log('STEP 4: Found element via polling')
        watchElement(el)
        return
      }
    }
  }, 2000)

  const masterTimeout = document.hidden ? 240000 : 120000
  setTimeout(() => {
    if (!isDone) {
      log('STEP 4: TIMEOUT (' + masterTimeout + 'ms, chunks=' + chunkCount + ')')
      isDone = true
      clearInterval(pollInterval)
      clearInterval(pollTimer)
      clearInterval(maxWaitPoll)
      clearTimeout(maxWaitTimer)
      removeStatus()
      contentObserver?.disconnect()
      childObserver.disconnect()
      _visibilityCheckFn = null
      sendToBg('DS_DONE', {})
    }
  }, masterTimeout)
}

// ========== 辅助函数 ==========

let _chunkCounter = 0

async function forwardChatChunk(taskId, type, data, retryCount = 0) {
  let token = await getToken()
  if (!token) {
    console.log('[NF_BG] FORWARD: No token, cannot forward', type, 'for', taskId)
    return { ok: false, error: 'No token' }
  }

  const endpoint = type === 'done' ? 'done' : type === 'error' ? 'error' : 'chunk'
  const contentLen = data?.content?.length || 0

  if (retryCount === 0) {
    _chunkCounter++
    console.log('[NF_BG] FORWARD #' + _chunkCounter + ': Sending to backend ============================')
    console.log('[NF_BG] FORWARD:   taskId    =', taskId)
    console.log('[NF_BG] FORWARD:   endpoint  =', endpoint)
    console.log('[NF_BG] FORWARD:   content_len=', contentLen)
    console.log('[NF_BG] FORWARD:   type      =', type)
    if (type === 'chunk') {
      console.log('[NF_BG] FORWARD:   preview   =', (data?.content || '').slice(-60).replace(/\n/g, '\\n'))
    }
  }

  const startTime = Date.now()

  try {
    const res = await fetch(`${API_BASE}/free-deepseek/extension-chat/${taskId}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
    const elapsed = Date.now() - startTime
    const resBody = await res.text().catch(() => '')

    console.log('[NF_BG] FORWARD #' + _chunkCounter + ': Response status=' + res.status + ' elapsed=' + elapsed + 'ms')

    if (!res.ok && retryCount < 2) {
      console.log('[NF_BG] FORWARD: Request failed (status=' + res.status + '), retrying...', retryCount + 1)
      await new Promise(r => setTimeout(r, 1000))
      return forwardChatChunk(taskId, type, data, retryCount + 1)
    }

    if (type === 'done' || type === 'error') {
      console.log('[NF_BG] FORWARD: Task ' + taskId + ' complete, total chunks=' + _chunkCounter)
      currentTaskId = null
      currentTaskStartTime = 0
      _chunkCounter = 0
    }

    return { ok: res.ok, status: res.status }
  } catch (e) {
    const elapsed = Date.now() - startTime
    console.log('[NF_BG] FORWARD #' + _chunkCounter + ': Network error after ' + elapsed + 'ms:', e.message)

    if (retryCount < 2) {
      console.log('[NF_BG] FORWARD: Retrying...', retryCount + 1)
      await new Promise(r => setTimeout(r, 1000))
      return forwardChatChunk(taskId, type, data, retryCount + 1)
    }

    console.log('[NF_BG] FORWARD: FAILED after retries:', e.message)

    if (type === 'done' || type === 'error') {
      currentTaskId = null
      currentTaskStartTime = 0
      _chunkCounter = 0
    }

    return { ok: false, error: e.message }
  }
}

// 直连模式：前端通过扩展直接发消息给 DS，不经过后端 SSE
async function directChatSend(content, projectId, includeContext, temperature) {
  try {
    let token = await getToken()
    if (!token) return { ok: false, error: '未登录' }

    // 通过后端创建任务（复用现有任务队列，用于 chunk/done 状态管理）
    const messages = [{ role: 'user', content }]
    const res = await fetch(`${API_BASE}/free-deepseek/extension-chat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        temperature: temperature || 0.7,
        project_id: projectId || '',
        include_context: includeContext || false,
        is_continue: false
      })
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      return { ok: false, error: `后端请求失败: ${res.status}` }
    }

    // 读取 SSE 获取 task_id
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let taskId = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        try {
          const data = JSON.parse(trimmed.slice(6))
          if (data.task_id) {
            taskId = data.task_id
            reader.cancel()
            break
          }
        } catch { }
      }
      if (taskId) break
    }

    if (!taskId) return { ok: false, error: '未获取到 task_id' }

    console.log('[NF_BG] DIRECT: Got task_id=' + taskId + ', now operating DS page directly')

    // 关键：直接调用 handleTask 操作 DS 页面，不等 SSE 轮询
    handleTask({ task_id: taskId, messages, context_txt: '' }, token)

    return { ok: true, taskId }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// 直连模式：生成设定
async function directGenSend(messages, projectId, includeContext, temperature, isContinue) {
  try {
    let token = await getToken()
    if (!token) return { ok: false, error: '未登录' }

    const res = await fetch(`${API_BASE}/free-deepseek/extension-chat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        temperature: temperature || 0.7,
        project_id: projectId || '',
        include_context: includeContext || false,
        is_continue: isContinue || false
      })
    })
    if (!res.ok) {
      return { ok: false, error: `后端请求失败: ${res.status}` }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let taskId = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        try {
          const data = JSON.parse(trimmed.slice(6))
          if (data.task_id) {
            taskId = data.task_id
            reader.cancel()
            break
          }
        } catch { }
      }
      if (taskId) break
    }

    if (!taskId) return { ok: false, error: '未获取到 task_id' }

    // 关键：直接调用 handleTask 操作 DS 页面，不等 SSE 轮询
    handleTask({ task_id: taskId, messages, context_txt: '', is_continue: isContinue }, token)

    return { ok: true, taskId }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function syncNfTokenFromTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'http://localhost:5173/*' });
    if (!tabs.length) return { ok: false };
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => {
        return {
          token: localStorage.getItem('access_token') || '',
          refreshToken: localStorage.getItem('refresh_token') || ''
        };
      }
    });
    const { token, refreshToken: rt } = results?.[0]?.result || {};
    if (token) {
      authToken = token;
      refreshToken = rt || '';
      await chrome.storage.local.set({ authToken, refreshToken });
      console.log('[NF] Token auto-synced from web app tab');
      return { ok: true };
    }
    return { ok: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function syncDSCookieFromTab() {
  try {
    const cookies = await chrome.cookies.getAll({ url: 'https://chat.deepseek.com' });
    if (!cookies.length) {
      return { ok: false, error: '未找到 chat.deepseek.com 的 Cookie，请先登录' };
    }
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log(`[NF] Got ${cookies.length} cookies from chat.deepseek.com`);
    const res = await fetch('http://localhost:9000/api/v1/free-deepseek/sync-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookieStr })
    });
    const data = await res.json();
    if (res.ok) {
      return { ok: true, length: data.length };
    }
    return { ok: false, error: data.detail || '同步失败' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function clearAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['authToken', 'refreshToken', 'savedAccount', 'savedPassword'], () => {
      authToken = '';
      refreshToken = '';
      savedAccount = '';
      savedPassword = '';
      resolve({ ok: true });
    });
  });
}

async function login(account, password) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password })
    });
    const data = await res.json();
    if (data.access_token) {
      authToken = data.access_token;
      refreshToken = data.refresh_token;
      savedAccount = account;
      savedPassword = password;
      chrome.storage.local.set({
        authToken,
        refreshToken,
        savedAccount,
        savedPassword
      });
      return { ok: true };
    }
    return { ok: false, error: data.detail || 'Login failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function refreshAccessToken() {
  // 兜底：如果全局变量为空（SW 刚重启），从 storage 读取
  if (!refreshToken) {
    const stored = await new Promise(r => chrome.storage.local.get('refreshToken', r));
    if (stored.refreshToken) refreshToken = stored.refreshToken;
  }
  if (!refreshToken) {
    return null;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    const data = await res.json();
    if (data.access_token) {
      authToken = data.access_token;
      refreshToken = data.refresh_token;
      chrome.storage.local.set({ authToken, refreshToken });
      return authToken;
    }
    return null;
  } catch (e) {
    console.error('[NF] Token refresh failed:', e);
    return null;
  }
}

async function autoReLogin() {
  // 兜底：如果全局变量为空（SW 刚重启），从 storage 读取
  if (!savedAccount || !savedPassword) {
    const stored = await new Promise(r => chrome.storage.local.get(['savedAccount', 'savedPassword'], r));
    if (stored.savedAccount) savedAccount = stored.savedAccount;
    if (stored.savedPassword) savedPassword = stored.savedPassword;
  }
  if (savedAccount && savedPassword) {
    const result = await login(savedAccount, savedPassword);
    if (result.ok) {
      console.log('[NF] Auto re-login successful');
      return true;
    }
  }
  return false;
}

async function getToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get('authToken', (data) => {
      resolve(data.authToken || '');
    });
  });
}

async function apiGet(path) {
  let token = await getToken();
  if (!token) {
    return { ok: false, error: '未登录，请先登录' };
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) {
      console.log('[NF] Got 401, trying to refresh token...');
      const newToken = await refreshAccessToken();
      if (!newToken) {
        console.log('[NF] Token refresh failed, trying auto re-login...');
        const relogin = await autoReLogin();
        if (!relogin) {
          return { ok: false, error: '登录已过期，请重新登录' };
        }
        token = await getToken();
      } else {
        token = newToken;
      }
      const retryRes = await fetch(`${API_BASE}${path}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (retryRes.status === 401) {
        return { ok: false, error: '登录已过期，请重新登录' };
      }
      const data = await retryRes.json();
      return { ok: true, data };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `连接后端失败: ${e.message}` };
  }
}

async function apiPut(path, body) {
  let token = await getToken();
  if (!token) {
    return { ok: false, error: '未登录，请先登录' };
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (res.status === 401) {
      const newToken = await refreshAccessToken();
      if (!newToken) {
        const relogin = await autoReLogin();
        if (!relogin) return { ok: false, error: '登录已过期，请重新登录' };
        token = await getToken();
      } else {
        token = newToken;
      }
      const retryRes = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (retryRes.status === 401) return { ok: false, error: '登录已过期，请重新登录' };
      const data = await retryRes.json();
      return { ok: true, data };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function importData(projectId, data) {
  let token = await getToken();
  if (!token) {
    return { ok: false, error: '未登录，请先登录' };
  }
  try {
    const res = await fetch(`${API_BASE}/import/${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });
    if (res.status === 401) {
      const newToken = await refreshAccessToken();
      if (!newToken) {
        const relogin = await autoReLogin();
        if (!relogin) {
          return { ok: false, error: '登录已过期，请重新登录' };
        }
        token = await getToken();
      } else {
        token = newToken;
      }
      const retryRes = await fetch(`${API_BASE}/import/${projectId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
      });
      if (retryRes.status === 401) {
        return { ok: false, error: '登录已过期，请重新登录' };
      }
      const result = await retryRes.json();
      if (retryRes.ok) return { ok: true, data: result };
      return { ok: false, error: result.detail || 'Import failed' };
    }
    const result = await res.json();
    if (res.ok) return { ok: true, data: result };
    return { ok: false, error: result.detail || 'Import failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const MODULE_LABELS = {
  era: '时代背景', geography: '地理环境', magic: '超凡体系',
  politics: '政治体系', race: '种族设定', religion: '宗教信仰',
  history: '历史事件', culture: '社会文化', economy: '经济体系'
};

const GENERATE_TYPES = {
  world: '世界观设定',
  characters: '角色设定',
  relationships: '角色关系',
  outline: '小说大纲',
  content: '小说正文'
};

async function getAllProjectData(projectId, currentChapterId = null) {
  try {
    const [worldRes, rulesRes, charsRes, relsRes, chaptersRes] = await Promise.all([
      apiGet(`/projects/${projectId}/world`),
      apiGet(`/projects/${projectId}/world-rules`),
      apiGet(`/projects/${projectId}/characters`),
      apiGet(`/projects/${projectId}/characters/relationships`),
      apiGet(`/projects/${projectId}/chapters`)
    ]);
    const modules = worldRes.ok ? worldRes.data : [];
    const rules = rulesRes.ok ? rulesRes.data : [];
    const characters = charsRes.ok ? charsRes.data : [];
    const relationships = relsRes.ok ? relsRes.data : [];
    const chapters = chaptersRes.ok ? chaptersRes.data : [];
    const charNameMap = {};
    characters.forEach(c => { charNameMap[c.id] = c.name; });
    const relationshipsWithNames = relationships.map(r => ({
      ...r,
      from_name: charNameMap[r.from_char_id] || r.from_char_id,
      to_name: charNameMap[r.to_char_id] || r.to_char_id
    }));
    let previousChapter = null;
    let currentChapter = null;
    if (currentChapterId && chapters.length > 0) {
      currentChapter = chapters.find(c => c.id === currentChapterId);
      const sortedChapters = [...chapters].sort((a, b) => (a.order || 0) - (b.order || 0));
      const idx = sortedChapters.findIndex(c => c.id === currentChapterId);
      if (idx > 0) {
        previousChapter = sortedChapters[idx - 1];
      }
    }
    return {
      ok: true,
      data: { modules, rules, characters, relationships: relationshipsWithNames, chapters, previousChapter, currentChapter }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function buildPrompt({ projectId, generateType, moduleTypes, characterIds, userPrompt }) {
  try {
    const [worldRes, rulesRes, charsRes, relsRes, chaptersRes] = await Promise.all([
      apiGet(`/projects/${projectId}/world`),
      apiGet(`/projects/${projectId}/world-rules`),
      apiGet(`/projects/${projectId}/characters`),
      apiGet(`/projects/${projectId}/characters/relationships`),
      apiGet(`/projects/${projectId}/chapters`)
    ]);
    const modules = worldRes.ok ? worldRes.data : [];
    const rules = rulesRes.ok ? rulesRes.data : [];
    const characters = charsRes.ok ? charsRes.data : [];
    const relationships = relsRes.ok ? relsRes.data : [];
    const chapters = chaptersRes.ok ? chaptersRes.data : [];
    const charNameMap = {};
    characters.forEach(c => { charNameMap[c.id] = c.name; });
    const relationshipsWithNames = relationships.map(r => ({
      ...r,
      from_name: charNameMap[r.from_char_id] || r.from_char_id,
      to_name: charNameMap[r.to_char_id] || r.to_char_id
    }));
    const moduleTypesList = Array.isArray(moduleTypes) ? moduleTypes : [];
    const modulesFiltered = modules.filter(m => moduleTypesList.length === 0 || moduleTypesList.includes(m.module_type));
    const moduleText = modulesFiltered.map(m => `- ${MODULE_LABELS[m.module_type] || m.module_type}: ${m.title}`).join('\n') || '（暂无）';
    const ruleText = rules.map(r => `- ${r.content}`).join('\n') || '（暂无）';
    const charText = characters.map(c => {
      const rels = relationshipsWithNames.filter(r => r.from_char_id === c.id || r.to_char_id === c.id);
      const relText = rels.map(r => `  - ${r.from_name} — ${r.relation_type} → ${r.to_name}`).join('\n');
      return `- ${c.name}${c.title ? ' (' + c.title + ')' : ''}\n  外貌: ${c.appearance || '未设定'}\n  性格: ${c.personality || '未设定'}${relText ? '\n' + relText : ''}`;
    }).join('\n\n') || '（暂无）';
    const chapterText = chapters.sort((a, b) => (a.order || 0) - (b.order || 0)).map(c => `- ${c.title || '无标题'}`).join('\n') || '（暂无）';
    let systemPrompt = `你是一个专业的小说创作辅助 AI。你被要求为以下小说项目提供创作服务。`;

    if (modulesFiltered.length > 0) {
      systemPrompt += `\n\n## 世界观设定\n${moduleText}`;
    }
    if (rules.length > 0) {
      systemPrompt += `\n\n## 硬规则\n${ruleText}`;
    }
    if (characters.length > 0) {
      systemPrompt += `\n\n## 角色设定\n${charText}`;
    }
    if (relationshipsWithNames.length > 0) {
      systemPrompt += `\n\n## 角色关系\n${relationshipsWithNames.map(r => `- ${r.from_name} — ${r.relation_type} → ${r.to_name}`).join('\n')}`;
    }
    if (chapters.length > 0) {
      systemPrompt += `\n\n## 现有章节\n${chapterText}`;
    }
    if (userPrompt) {
      systemPrompt += `\n\n## 用户具体要求\n${userPrompt}`;
    }
    systemPrompt += `\n\n注意：1. 所有回复必须使用中文。2. 请严格遵守以上设定，不要自行创造与设定矛盾的内容。3. 如果项目中已有相关设定，请优先参考并延续已有设定。`;

    return { ok: true, data: { prompt: systemPrompt } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}