(function () {
  'use strict';

  var TAG = '[NF_SSE]'
  var _nf_xhrOpen = XMLHttpRequest.prototype.open;
  var _nf_origFetch = window.fetch;
  var _nf_origGetReader = ReadableStream.prototype.getReader;
  var _chunkCount = 0
  var _firstTextSeen = false

  function sendChunk(fullText) {
    var cleaned = cleanContent(fullText)
    _chunkCount++
    if (_chunkCount <= 5 || _chunkCount % 50 === 0) {
      console.log(TAG + ' sendChunk #' + _chunkCount + ', len=' + cleaned.length + ', preview=' + cleaned.slice(0, 60).replace(/\n/g, '\\n'))
    }
    window.postMessage({ source: 'nf-main-world', type: 'net_CHUNK', content: cleaned, taskId: window.__nf_currentTaskId || '' }, '*');
    window.__nf_interceptorSent = true;
    window.__nf_ds_paused = false
  }

  var _doneSent = false
  function sendDone() {
    if (_doneSent) return
    _doneSent = true
    console.log(TAG + ' sendDone, totalChunks=' + _chunkCount)
    checkDsState()
    window.postMessage({ source: 'nf-main-world', type: 'net_DONE', taskId: window.__nf_currentTaskId || '' }, '*')
  }

  var CODE_LANGS = ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'sql', 'bash', 'shell', 'powershell', 'html', 'css', 'json', 'xml', 'yaml', 'markdown', 'lua', 'r', 'matlab', 'perl', 'haskell', 'elixir', 'clojure', 'lisp', 'scheme', 'fortran', 'cobol', 'pascal', 'assembly', 'asm', 'dart', 'vue', 'jsx', 'tsx', 'scss', 'less', 'sass', 'dockerfile', 'makefile', 'cmake', 'tex', 'latex'];

  // DeepSeek response 对象中可能包含文本内容的字段名（按优先级排序）
  var RESPONSE_TEXT_FIELDS = ['text', 'content', 'accumulated_text', 'accumulated_content', 'message', 'reasoning_content', 'answer', 'output', 'reply'];

  // 从 fragments 数组中提取文本
  function extractFragmentsText(fragments) {
    if (!Array.isArray(fragments)) return ''
    var result = ''
    for (var i = 0; i < fragments.length; i++) {
      var f = fragments[i]
      if (typeof f === 'string') {
        result += f
      } else if (f && typeof f === 'object') {
        // fragments 可能是 [{text: "你好"}, {content: "..."}] 格式
        for (var fi = 0; fi < RESPONSE_TEXT_FIELDS.length; fi++) {
          var val = f[RESPONSE_TEXT_FIELDS[fi]]
          if (typeof val === 'string' && val.length > 0) {
            result += val
            break
          }
        }
      }
    }
    return result
  }

  function cleanContent(text) {
    if (!text) return text;
    var t = text.replace(/FINISHED$/, '').trimEnd();
    if (t.startsWith('```')) return t;
    var langMatch = t.match(/^(\w+)\n/);
    if (langMatch && CODE_LANGS.indexOf(langMatch[1].toLowerCase()) >= 0) {
      t = '```' + langMatch[1] + '\n' + t.slice(langMatch[0].length);
    }
    return t;
  }

  // ★ 统一的 SSE 数据提取函数：尝试多种格式
  // 优先检查 snapshot（有 response 对象时），再检查 delta
  function extractDelta(data) {
    // 格式1: data.v.response 中的文本字段 (DeepSeek snapshot) — 最优先
    if (data.v?.response) {
      for (var fi = 0; fi < RESPONSE_TEXT_FIELDS.length; fi++) {
        var field = RESPONSE_TEXT_FIELDS[fi]
        var val = data.v.response[field]
        if (typeof val === 'string' && val.length > 0) {
          return { type: 'snapshot', text: val }
        }
      }
      // 格式1x: data.v.response.fragments (DeepSeek 新格式，文本在 fragments 数组中)
      var fragments = data.v.response.fragments
      if (Array.isArray(fragments) && fragments.length > 0) {
        var fragText = extractFragmentsText(fragments)
        if (fragText.length > 0) {
          return { type: 'snapshot', text: fragText }
        }
      }
    }
    // 格式2: data.v.response.choices[0].delta.content (OpenAI 兼容)
    if (data.v?.response?.choices?.[0]?.delta?.content) return { type: 'delta', text: data.v.response.choices[0].delta.content }
    // 格式3: data.v 是非空字符串 (DeepSeek delta) — 排除空字符串
    if (typeof data.v === 'string' && data.v.length > 0) return { type: 'delta', text: data.v }
    // 格式4: data.choices[0].delta.content (标准 OpenAI)
    if (data.choices?.[0]?.delta?.content) return { type: 'delta', text: data.choices[0].delta.content }
    // 格式5: data.choices[0].text
    if (data.choices?.[0]?.text) return { type: 'delta', text: data.choices[0].text }
    // 格式6: data.content
    if (typeof data.content === 'string' && data.content.length > 0) return { type: 'delta', text: data.content }
    // 格式7: data.delta.content
    if (data.delta?.content) return { type: 'delta', text: data.delta.content }
    // 格式8: data.delta.text
    if (data.delta?.text) return { type: 'delta', text: data.delta.text }
    // 格式9: data.text
    if (typeof data.text === 'string' && data.text.length > 0) return { type: 'delta', text: data.text }
    return null
  }

  // ★ 处理单行 SSE 数据，返回是否处理成功
  function processSseLine(trimmed, cumulativeText, source) {
    if (trimmed === 'event: close') {
      console.log(TAG + ' [' + source + '] event:close detected')
      sendDone()
      return { action: 'done', cumulativeText: cumulativeText }
    }
    if (!trimmed.startsWith('data: ')) return { action: 'skip', cumulativeText: cumulativeText }

    var dataStr = trimmed.slice(6)
    if (dataStr === '[DONE]') {
      console.log(TAG + ' [' + source + '] [DONE] marker')
      sendDone()
      return { action: 'done', cumulativeText: cumulativeText }
    }

    try {
      var data = JSON.parse(dataStr)

      // ★ 打印前 15 个 SSE 事件，帮助诊断 DeepSeek 响应格式
      if (_chunkCount < 15 && data.v?.response) {
        var respKeys = Object.keys(data.v.response).join(',')
        console.log(TAG + ' [' + source + '] event #' + _chunkCount + ': v.response keys=' + respKeys)
        // 遍历 RESPONSE_TEXT_FIELDS 打印每个字段的值
        for (var di = 0; di < RESPONSE_TEXT_FIELDS.length; di++) {
          var df = RESPONSE_TEXT_FIELDS[di]
          var dv = data.v.response[df]
          if (dv !== undefined && dv !== null && dv !== '') {
            console.log(TAG + ' [' + source + ']   response.' + df + ': type=' + typeof dv + ', len=' + (typeof dv === 'string' ? dv.length : 'N/A') + ', preview=' + JSON.stringify(dv).slice(0, 120))
          }
        }
        // 打印 fragments 字段
        var frags = data.v.response.fragments
        if (frags !== undefined && frags !== null) {
          console.log(TAG + ' [' + source + ']   response.fragments: type=' + typeof frags + ', isArray=' + Array.isArray(frags) + ', len=' + (Array.isArray(frags) ? frags.length : 'N/A') + ', preview=' + JSON.stringify(frags).slice(0, 200))
        }
      }

      var result = extractDelta(data)

      if (!result) {
        // 打印前 10 个未知格式事件，帮助诊断
        if (_chunkCount < 10) {
          console.warn(TAG + ' [' + source + '] ⚠️ skip event, keys=' + Object.keys(data).join(',') + ', preview=' + dataStr.slice(0, 300))
        }
        return { action: 'skip', cumulativeText: cumulativeText }
      }

      if (result.type === 'snapshot') {
        // snapshot 是累积全文，只要比当前长就更新（修复丢失前几个字符的问题）
        if (result.text && result.text.length > cumulativeText.length) {
          if (!_firstTextSeen) {
            _firstTextSeen = true
            console.log(TAG + ' [' + source + '] FIRST text [snapshot], len=' + result.text.length + ', preview=' + JSON.stringify(result.text).slice(0, 100))
          }
          cumulativeText = result.text
          sendChunk(cumulativeText)
        }
      } else {
        if (!_firstTextSeen) {
          _firstTextSeen = true
          console.log(TAG + ' [' + source + '] FIRST text [delta], len=' + result.text.length + ', preview=' + JSON.stringify(result.text).slice(0, 100))
        }
        cumulativeText += result.text
        // ★ DeepSeek API 不返回开头的 {，检测并补全
        if (cumulativeText.length > 0 && cumulativeText.length < 50) {
          var t = cumulativeText.trimStart()
          if (t.length > 0 && t.charAt(0) === '"' && t.indexOf('{') === -1) {
            cumulativeText = '{\n' + cumulativeText
            console.log(TAG + ' [' + source + '] 🔧 补全 {, len=' + cumulativeText.length)
          }
        }
        sendChunk(cumulativeText)
      }
    } catch (e) {
      // JSON 解析失败，跳过
    }

    return { action: 'ok', cumulativeText: cumulativeText }
  }

  // ====== XHR 拦截 ======
  var _xhrHandlerCount = 0
  XMLHttpRequest.prototype.open = function (method, url) {
    if (url && typeof url === 'string' && url.includes('completion')) {
      _xhrHandlerCount++
      console.log(TAG + ' XHR#' + _xhrHandlerCount + ' open: ' + method + ' ' + url)
      var xhr = this;
      var pending = '';
      var cumulativeText = '';
      var done = false;
      var readyStateLogCount = 0

      xhr.addEventListener('readystatechange', function () {
        try {
          readyStateLogCount++
          // 只打印前几次 readyState 变化，避免刷屏
          if (readyStateLogCount <= 10 || xhr.readyState === 4) {
            console.log(TAG + ' XHR#' + _xhrHandlerCount + ' readyState=' + xhr.readyState + ', responseText_len=' + (xhr.responseText || '').length)
          }

          if (xhr.readyState !== 3 && xhr.readyState !== 4) return
          if (done) return

          var text = xhr.responseText || ''
          if (text.length <= pending.length) return

          var newData = text.slice(pending.length);
          pending = text;
          var lastNewline = newData.lastIndexOf('\n');
          if (lastNewline === -1 && xhr.readyState !== 4) return;
          var completeData = lastNewline >= 0 ? newData.slice(0, lastNewline) : newData;
          if (lastNewline >= 0) {
            pending = text.slice(0, text.length - (newData.length - lastNewline - 1));
          } else {
            pending = text;
          }

          var lines = completeData.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var trimmed = lines[i].trim();
            if (!trimmed) continue;
            var result = processSseLine(trimmed, cumulativeText, 'XHR')
            cumulativeText = result.cumulativeText
            if (result.action === 'done') { done = true; return }
          }

          if (xhr.readyState === 4 && !done) {
            console.log(TAG + ' XHR#' + _xhrHandlerCount + ' readyState=4, no [DONE] received, sending done')
            sendDone()
          }
        } catch (e) {
          console.warn(TAG + ' XHR#' + _xhrHandlerCount + ' error:', e.message)
        }
      });
    }
    return _nf_xhrOpen.apply(this, arguments);
  };

  // ====== ReadableStream 拦截 ======
  var _rsCount = 0
  ReadableStream.prototype.getReader = function (mode) {
    var reader = _nf_origGetReader.call(this, mode);
    var _origRead = reader.read.bind(reader);
    var cumulativeText = '';
    var sniffed = false;
    _rsCount++
    var rsId = _rsCount

    reader.read = async function () {
      var result = await _origRead();
      if (result.value && !result.done) {
        var text = new TextDecoder().decode(result.value, { stream: true });
        if (!sniffed && text.includes('data: ') && (text.includes('"v"') || text.includes('"choices"') || text.includes('"content"'))) {
          sniffed = true
          cumulativeText = ''
          console.log(TAG + ' RS#' + rsId + ' stream detected')
        }
        if (sniffed) {
          var lines = text.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var trimmed = lines[i].trim();
            if (!trimmed) continue;
            var result2 = processSseLine(trimmed, cumulativeText, 'RS#' + rsId)
            cumulativeText = result2.cumulativeText
            if (result2.action === 'done') { break }
          }
        }
      }
      if (result.done && sniffed) {
        console.log(TAG + ' RS#' + rsId + ' stream ended')
        sendDone();
      }
      return result;
    };
    return reader;
  };

  // ====== Fetch 拦截 ======
  window.fetch = new Proxy(_nf_origFetch, {
    apply: function (target, ctx, args) {
      var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (url.includes('chat') || url.includes('completion')) {
        console.log(TAG + ' fetch: ' + url);
        var result = target.apply(ctx, args);
        result.then(function (res) {
          if (!res.body || !res.ok || res.__nf_intercepted) return res;
          res.__nf_intercepted = true;
          if (res.body.locked) {
            console.log(TAG + ' fetch: body locked, skipping')
            return res
          }
          try {
            var tee = res.body.tee();
            var forUs = tee[0];
            var forPage = tee[1];
            var cumulativeText = '';
            (async function () {
              var reader = forUs.getReader();
              var dec = new TextDecoder();
              var buf = '';
              try {
                while (true) {
                  var rd = await reader.read();
                  if (rd.done) break;
                  buf += dec.decode(rd.value, { stream: true });
                  while (buf.includes('\n')) {
                    var idx = buf.indexOf('\n');
                    var line = buf.slice(0, idx).trim();
                    buf = buf.slice(idx + 1);
                    if (!line) continue;
                    var result2 = processSseLine(line, cumulativeText, 'fetch')
                    cumulativeText = result2.cumulativeText
                    if (result2.action === 'done') { break }
                  }
                }
              } catch (e) {
                console.warn(TAG + ' fetch read error:', e.message)
              }
              sendDone();
            })();
            return new Response(forPage, { status: res.status, statusText: res.statusText, headers: res.headers });
          } catch (e) {
            console.warn(TAG + ' fetch tee error:', e.message)
            return res;
          }
        });
        return result;
      }
      return target.apply(ctx, args);
    }
  });

  // ★ 监听新任务开始，重置状态（否则第二次以后 sendDone 会被 _doneSent 阻止）
  window.addEventListener('message', function (event) {
    if (event.data?.source === 'nf-main-world' && event.data?.type === 'net_TASK_START') {
      _doneSent = false
      _chunkCount = 0
      _firstTextSeen = false
      console.log(TAG + ' New task started, reset _doneSent and _chunkCount')
    }
  })

  console.log(TAG + ' Network interceptors installed (XHR + ReadableStream + fetch)')

  // === DS 状态检测 ===
  var _nf_lastDsState = ''

  function checkDsState() {
    var buttons = document.querySelectorAll('button')
    var hasContinue = false
    var hasStop = false

    for (var i = 0; i < buttons.length; i++) {
      var txt = (buttons[i].textContent || '').trim()
      if (txt.includes('继续生成') || txt.includes('Continue')) {
        hasContinue = true
      }
      if (txt === '停止' || txt === 'Stop') {
        hasStop = true
      }
    }

    var state = hasStop ? 'generating' : hasContinue ? 'continue' : 'idle'
    window.__nf_ds_state = state
    if (state !== _nf_lastDsState) {
      _nf_lastDsState = state
      console.log(TAG + ' DS_STATE: ' + state)
      window.postMessage({ source: 'nf-main-world', type: 'net_DS_STATE', state: state, taskId: window.__nf_currentTaskId || '' }, '*')
      if (state === 'continue') {
        window.__nf_ds_paused = true
      }
    }
    return state
  }

  function startDsStateObserver() {
    setInterval(checkDsState, 2000)
    checkDsState()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDsStateObserver)
  } else {
    startDsStateObserver()
  }
})();
