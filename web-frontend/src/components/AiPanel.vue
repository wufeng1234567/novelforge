<script setup>
import { ref, reactive, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { generateStream, generateApi } from '../api/generate'
import { freeModeApi } from '../api/freeMode'
import { importApi } from '../api/import'
import { extractJSON, validateImportData, buildGeneratePrompt, countImportData, detectConflicts, MODULE_LABELS, GENERATE_TYPES } from '../utils/aiGenerate'
import StreamText from './StreamText.vue'
import ScrollButton from './ScrollButton.vue'
import MdPreviewModal from './MdPreviewModal.vue'

function cleanDsNoise(text) {
  // 过滤 DeepSeek 代码块 UI 噪音（语言标签 + 复制/下载按钮文本）
  const lines = text.split('\n')
  const result = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    // 跳过孤立的 UI 文本行：复制、下载、运行
    if (/^(复制|下载|运行)$/.test(line)) continue
    // 跳过语言标签行（后面紧跟复制/下载）
    const nextLine = (lines[i + 1] || '').trim()
    if (/^(复制|下载|运行)$/.test(nextLine) && line.length < 20 && !line.startsWith('|') && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('*') && !line.startsWith('>')) {
      continue
    }
    result.push(lines[i])
  }
  return result.join('\n')
}

function renderMd(content) {
  if (!content) return ''
  const cleaned = cleanDsNoise(content)
  let renderContent = cleaned
  // 流式输出时代码块 fence 可能未闭合，追加临时闭合 fence 以便实时渲染
  const fences = cleaned.match(/```/g)
  if (fences && fences.length % 2 !== 0) {
    // 确保 fence 后有换行，帮助 marked 正确解析
    const lastFence = cleaned.lastIndexOf('```')
    const afterFence = cleaned.slice(lastFence + 3)
    if (!afterFence.startsWith('\n')) {
      renderContent = cleaned.slice(0, lastFence + 3) + '\n' + afterFence + '\n```\n'
    } else {
      renderContent = cleaned + '\n```\n'
    }
  }
  try {
    return DOMPurify.sanitize(marked.parse(renderContent))
  } catch {
    return cleaned
  }
}

function cachedRenderMd(content) {
  if (!content) return ''
  if (mdCache.has(content)) return mdCache.get(content)
  const html = renderMd(content)
  mdCache.set(content, html)
  return html
}

const props = defineProps({
  projectId: { type: String, required: true },
  chapterId: { type: String, required: true }
})

const emit = defineEmits(['insert', 'close', 'import-selection'])

const mode = ref('continue') // continue | rewrite | suggestions | free-chat | generate
const genType = ref('world')
const genModuleTypes = ref(Object.keys(MODULE_LABELS))
const genUserHint = ref('')
const genLoading = ref(false)
const genStreamDone = ref(false)
const genResult = ref('')
const genError = ref('')
const genIncludeContext = ref(false) // 是否附带项目设定
const genImportMode = ref('overwrite') // overwrite | append
const genStreamingContent = ref('')  // 流式输出的实时内容
// 预览相关
const genStep = ref('config') // config | preview
const genPreviewData = ref(null)
const genPreviewMode = ref('render') // render | json
const genConflicts = ref({})
const genClearFlags = ref({
  world_modules: false,
  world_rules: false,
  characters: false,
  relationships: false
})

// ---- 生成设定历史记录 ----
const GEN_HISTORY_KEY = `nf_ai_gen_history_${props.projectId}`
const genHistory = ref([])
const showHistory = ref(false)

function loadGenHistory() {
  try {
    const cached = localStorage.getItem(GEN_HISTORY_KEY)
    if (cached) genHistory.value = JSON.parse(cached)
  } catch (e) { }
}

function saveGenHistory() {
  try {
    localStorage.setItem(GEN_HISTORY_KEY, JSON.stringify(genHistory.value))
  } catch (e) { }
}

function addGenHistory(record) {
  if (genHistory.value.length >= 50) {
    genHistory.value = genHistory.value.slice(0, 49)
  }
  genHistory.value.unshift(record)
  saveGenHistory()
}

function deleteGenHistory(id) {
  genHistory.value = genHistory.value.filter(h => h.id !== id)
  saveGenHistory()
}

function clearGenHistory() {
  genHistory.value = []
  saveGenHistory()
}

function buildHistorySummary(jsonData) {
  const parts = []
  if (jsonData.world_modules?.length) parts.push(`${jsonData.world_modules.length}个世界观`)
  if (jsonData.world_rules?.length) parts.push(`${jsonData.world_rules.length}条规则`)
  if (jsonData.characters?.length) parts.push(`${jsonData.characters.length}个角色`)
  if (jsonData.relationships?.length) parts.push(`${jsonData.relationships.length}条关系`)
  return parts.join('、') || '无数据'
}

function formatGenTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function restoreGenHistory(record) {
  // 恢复生成配置
  genType.value = record.genType || 'world'
  genModuleTypes.value = record.moduleTypes ? [...record.moduleTypes] : Object.keys(MODULE_LABELS)
  genUserHint.value = record.userHint || ''
  genImportMode.value = record.importMode || 'overwrite'
  genIncludeContext.value = record.includeContext || false

  // 恢复生成结果
  genStreamingContent.value = record.rawContent || ''
  genResult.value = ''
  genStreamDone.value = true
  genLoading.value = false
  genError.value = ''

  if (record.jsonData) {
    genPreviewData.value = record.jsonData
    genStep.value = 'preview'
    importApi.getProjectSettings(props.projectId).then(({ data: existing }) => {
      genConflicts.value = detectConflicts(record.jsonData, existing)
      for (const key of Object.keys(genConflicts.value)) {
        genClearFlags.value[key] = true
      }
    }).catch(() => {})
  }

  showHistory.value = false
}
const prompt = ref('')
const selectedText = ref('')
const temperature = ref(0.7)
const loading = ref(false)
const result = ref('')
const error = ref('')
const streamDone = ref(false)

const chatMessages = ref([])
const mdCache = new Map() // 缓存已渲染的 markdown，避免重复解析
const visibleCount = ref(50)
const visibleChatMessages = computed(() => chatMessages.value.slice(-visibleCount.value))
const hasMoreMessages = computed(() => chatMessages.value.length > visibleCount.value)
function loadMoreMessages() {
  visibleCount.value += 50
}
const chatInput = ref('')
const chatLoading = ref(false)
const chatError = ref('')
const chatEndpoint = '/api/v1/free-deepseek/extension-chat'
const extensionConnected = ref(false)
const includeContext = ref(true)
const chatStatusMsg = ref('')

const expandedMessage = ref(null)
const showExpandModal = ref(false)
// 通用放大查看
const expandModalVisible = ref(false)
const expandModalTitle = ref('')
const expandModalContent = ref('')
const expandSourceMsg = ref(null)  // 响应式消息对象，用于流式实时更新（复用免费聊天模式）
const chatContainer = ref(null)

const CHAT_CACHE_KEY = `nf_ai_chat_ext_${props.projectId}`
const COOKIE_CACHE_KEY = `nf_ai_chat_cookie_${props.projectId}`
const CONTEXT_KEY = `nf_ai_include_context_${props.projectId}`
const COOKIE_CONTEXT_KEY = `nf_ai_cookie_include_context_${props.projectId}`

function saveChatCache() {
  try {
    localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(chatMessages.value))
  } catch (e) { }
}

function loadChatCache() {
  try {
    const cached = localStorage.getItem(CHAT_CACHE_KEY)
    if (cached) {
      chatMessages.value = JSON.parse(cached)
    }
  } catch (e) { }
}

function saveCookieCache() {
  try {
    localStorage.setItem(COOKIE_CACHE_KEY, JSON.stringify(cookieMessages.value))
  } catch (e) { }
}

function loadCookieCache() {
  try {
    const cached = localStorage.getItem(COOKIE_CACHE_KEY)
    if (cached) {
      cookieMessages.value = JSON.parse(cached)
    }
  } catch (e) { }
}

function loadIncludeContext() {
  try {
    const val = localStorage.getItem(CONTEXT_KEY)
    if (val !== null) {
      includeContext.value = val === 'true'
    }
  } catch (e) { }
}

function saveIncludeContext() {
  try {
    localStorage.setItem(CONTEXT_KEY, String(includeContext.value))
  } catch (e) { }
}

function loadCookieIncludeContext() {
  try {
    const val = localStorage.getItem(COOKIE_CONTEXT_KEY)
    if (val !== null) {
      cookieIncludeContext.value = val === 'true'
    }
  } catch (e) { }
}

function saveCookieIncludeContext() {
  try {
    localStorage.setItem(COOKIE_CONTEXT_KEY, String(cookieIncludeContext.value))
  } catch (e) { }
}

function expandMessage(msg) {
  expandedMessage.value = msg
  showExpandModal.value = true
}

function closeExpandModal() {
  showExpandModal.value = false
  expandedMessage.value = null
}

function openExpandModal(title, content, sourceMsg = null) {
  expandModalTitle.value = title
  expandModalContent.value = content
  // ★ 关键修复：用 reactive() 包裹，保留嵌套 ref 的响应式连接
  // 直接赋值 plain object 会触发 toReactive() 将 ref 解包为静态值，断开响应式链
  expandSourceMsg.value = sourceMsg ? reactive(sourceMsg) : null
  expandModalVisible.value = true
}

function closeGenericExpandModal() {
  expandModalVisible.value = false
  expandModalContent.value = ''
  expandSourceMsg.value = null
}

// ---- 右键菜单 ----
const contextMenu = ref({ visible: false, x: 0, y: 0, msg: null, idx: -1 })

function onMsgContextMenu(e, msg, idx) {
  e.preventDefault()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, msg, idx }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

function ctxExpand() {
  if (contextMenu.value.msg) expandMessage(contextMenu.value.msg)
  closeContextMenu()
}

function ctxCopy() {
  if (contextMenu.value.msg?.content) {
    navigator.clipboard.writeText(contextMenu.value.msg.content).then(() => {
      showToast('已复制到剪贴板')
    })
  }
  closeContextMenu()
}

// ---- Toast 提示 ----
const toast = ref({ visible: false, text: '' })
let toastTimer = null
function showToast(text) {
  clearTimeout(toastTimer)
  toast.value = { visible: true, text }
  toastTimer = setTimeout(() => { toast.value.visible = false }, 1500)
}

function ctxDelete() {
  const idx = contextMenu.value.idx
  if (idx >= 0) chatMessages.value.splice(idx, 1)
  closeContextMenu()
}

function ctxImport() {
  if (contextMenu.value.msg?.content) {
    emit('import-selection', contextMenu.value.msg.content)
  }
  closeContextMenu()
}

// Cookie 聊天模式
const cookieMessages = ref([])
const cookieInput = ref('')
const cookieLoading = ref(false)
const cookieError = ref('')
const cookieStatusMsg = ref('')
const cookieIncludeContext = ref(true)
const cookieConnected = ref(false)
const cookieChatEndpoint = '/api/v1/free-deepseek/chat'
const cookieContainer = ref(null)
const showCookieScrollToBottom = ref(false)

// DeepSeek 连接状态 - 通过 WebSocket 实时接收
const dsConnectionStatus = ref('checking')
const dsStatusText = ref('检查连接中...')
let aiWs = null
let aiWsReconnectTimer = null
let aiWsReconnectDelay = 1000
let aiWsPingTimer = null
let aiWsClosing = false // 主动关闭时为 true，防止 onclose 触发重复重连

function setStatus(msg) {
  chatStatusMsg.value = msg
}

function connectAiWs() {
  if (aiWs) {
    aiWsClosing = true
    try { aiWs.close() } catch { }
    aiWs = null
  }
  clearTimeout(aiWsReconnectTimer)
  clearInterval(aiWsPingTimer)

  const token = localStorage.getItem('access_token')
  if (!token) {
    console.log('[NF_WS] No token found, skipping WS connect')
    dsConnectionStatus.value = 'no-extension'
    dsStatusText.value = '请先登录后再试哦 (・_・)'
    return
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${window.location.host}/api/v1/free-deepseek/ws/ai-assistant?token=${encodeURIComponent(token)}`

  try {
    aiWs = new WebSocket(url)
  } catch (e) {
    scheduleWsReconnect()
    return
  }

  aiWs.onopen = () => {
    aiWsReconnectDelay = 1000
    dsConnectionStatus.value = 'checking'
    dsStatusText.value = '等待扩展状态...'
    aiWsPingTimer = setInterval(() => {
      if (aiWs?.readyState === WebSocket.OPEN) {
        aiWs.send('ping')
      }
    }, 20000)
  }

  aiWs.onmessage = (evt) => {
    if (evt.data === 'pong') return
    try {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'extension_status') {
        if (msg.connected) {
          dsConnectionStatus.value = 'connected'
          dsStatusText.value = '已就绪'
        } else {
          if (chatLoading.value) return
          dsConnectionStatus.value = 'disconnected'
          dsStatusText.value = '扩展未连接，请确保 DS 页面与本网页在同一浏览器中'
        }
      }
    } catch { }
  }

  aiWs.onclose = () => {
    clearInterval(aiWsPingTimer)
    if (aiWsClosing) {
      aiWsClosing = false
      return
    }
    scheduleWsReconnect()
  }
}

function scheduleWsReconnect() {
  clearTimeout(aiWsReconnectTimer)
  aiWsReconnectTimer = setTimeout(() => {
    aiWsReconnectDelay = Math.min(aiWsReconnectDelay * 1.5, 10000)
    connectAiWs()
  }, aiWsReconnectDelay)
}

function disconnectAiWs() {
  clearTimeout(aiWsReconnectTimer)
  clearInterval(aiWsPingTimer)
  if (aiWs) {
    try { aiWs.close() } catch { }
    aiWs = null
  }
}

// ---- Cookie 聊天模式 ----
function setCookieStatus(msg) {
  cookieStatusMsg.value = msg
}

async function checkCookieStatus() {
  try {
    const { data } = await freeModeApi.cookieStatus()
    cookieConnected.value = data.has_cookie
    if (data.has_cookie) {
      setCookieStatus('Cookie 已就绪 (' + data.length + ' chars)')
    } else {
      setCookieStatus('未同步 Cookie')
    }
  } catch (e) {
    cookieConnected.value = false
    setCookieStatus('检查失败')
  }
}

async function syncCookie() {
  setCookieStatus('正在同步 Cookie...')

  // 通过 content script 中转请求到扩展
  window.postMessage({ type: 'NF_SYNC_COOKIE_REQUEST' }, '*')

  // 监听结果
  const handler = (event) => {
    if (event.data?.type === 'NF_SYNC_COOKIE_RESULT') {
      window.removeEventListener('message', handler)
      if (event.data.ok) {
        cookieConnected.value = true
        setCookieStatus('Cookie 已同步 (' + event.data.length + ' chars)')
      } else {
        setCookieStatus('同步失败: ' + (event.data.error || '请确保已打开 chat.deepseek.com'))
      }
    }
  }
  window.addEventListener('message', handler)

  // 超时处理
  setTimeout(() => {
    window.removeEventListener('message', handler)
    if (!cookieConnected.value) {
      setCookieStatus('同步超时，请确保已安装扩展并打开过 chat.deepseek.com')
    }
  }, 5000)
}

async function handleCookieSend() {
  if (!cookieInput.value.trim() || cookieLoading.value) return

  const userMessage = cookieInput.value.trim()
  cookieInput.value = ''
  cookieError.value = ''

  cookieMessages.value.push({ role: 'user', content: userMessage })
  autoScrollCookieToBottom()
  cookieLoading.value = true
  setCookieStatus('正在发送...')

  try {
    const token = localStorage.getItem('access_token')
    const messages = cookieMessages.value.map(m => ({ role: m.role, content: m.content }))

    const response = await fetch(cookieChatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        messages,
        temperature: temperature.value,
        project_id: props.projectId,
        include_context: cookieIncludeContext.value
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      if (response.status === 429) {
        throw new Error('请求过于频繁，请等待 15 秒后重试')
      }
      throw new Error(errText || `请求失败: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let assistantMessage = ''

    cookieMessages.value.push({ role: 'assistant', content: '' })
    autoScrollCookieToBottom()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const dataStr = trimmed.slice(6)
        if (dataStr === '[DONE]') {
          setCookieStatus('回复完成')
          continue
        }
        try {
          const data = JSON.parse(dataStr)
          if (data.type === 'retrying') {
            setCookieStatus(data.message || '正在重试...')
            continue
          }
          if (data.error) {
            throw new Error(data.error)
          }
          if (data.content) {
            assistantMessage += data.content
            const lastMsg = cookieMessages.value[cookieMessages.value.length - 1]
            if (lastMsg?.role === 'assistant') {
              lastMsg.content = assistantMessage
            }
            autoScrollCookieToBottom()
            setCookieStatus('DeepSeek 正在回复...')
          }
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e
        }
      }
    }

    cookieLoading.value = false
    autoScrollCookieToBottom()
    if (!cookieError.value) {
      setCookieStatus('回复完成')
      setTimeout(() => setCookieStatus(''), 3000)
    }
  } catch (e) {
    cookieError.value = e.message || '发送失败'
    cookieLoading.value = false
    setCookieStatus('错误: ' + e.message)
    cookieMessages.value.push({ role: 'assistant', content: '抱歉，发生了错误: ' + (e.message || '未知错误') })
    autoScrollCookieToBottom()
  }
}

function handleCookieKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleCookieSend()
  }
}

watch(includeContext, (val) => {
  saveIncludeContext()
})

watch(cookieIncludeContext, (val) => {
  saveCookieIncludeContext()
})

watch(chatMessages, () => {
  saveChatCache()
  // 流式输出时强制浏览器重绘（解决背景标签页不刷新代码块的问题）
  if (chatLoading.value && chatContainer.value) {
    // 读取 offsetHeight 强制同步 reflow，让浏览器处理待处理的 DOM 更新
    const _h = chatContainer.value.offsetHeight
    // 额外手段：toggle 一个空样式触发 style recalc
    chatContainer.value.style.opacity = '0.9999'
    chatContainer.value.style.opacity = ''
  }
}, { deep: true })

watch(cookieMessages, () => {
  saveCookieCache()
}, { deep: true })

watch(mode, (val) => {
  if (val === 'free-chat') {
    nextTick(() => nextTick(() => requestAnimationFrame(scrollToBottom)))
  }
  if (val !== 'generate') {
    genStep.value = 'config'
    genPreviewData.value = null
    // 修复：清理残留状态，避免切回时显示"AI正在生成"但无内容
    genLoading.value = false
    genStreamingContent.value = ''
    genResult.value = ''
    genError.value = ''
    genStreamDone.value = false
  }
})

onMounted(() => {
  loadChatCache()
  loadCookieCache()
  loadIncludeContext()
  loadCookieIncludeContext()
  loadGenHistory()
  checkCookieStatus()
  connectAiWs()

  // 标签页切回前台时立即重连 WebSocket
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  disconnectAiWs()
  clearTimeout(aiWsRecheckTimer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('message', onDirectMessage)
})

function onVisibilityChange() {
  if (document.hidden) return
  if (!aiWs || aiWs.readyState === WebSocket.CLOSED || aiWs.readyState === WebSocket.CLOSING) {
    aiWsReconnectDelay = 0
    clearTimeout(aiWsReconnectTimer)
    connectAiWs()
  }
}

let aiWsRecheckTimer = null

function switchTabHint() {
  dsConnectionStatus.value = 'checking'
  dsStatusText.value = '正在重连...'
  aiWsReconnectDelay = 0
  clearTimeout(aiWsReconnectTimer)
  clearTimeout(aiWsRecheckTimer)
  connectAiWs()
  // WS 重连后后端会立即发扩展状态，如果还是断开则延迟重试
  setTimeout(() => {
    if (dsConnectionStatus.value !== 'connected') {
      scheduleExtStatusRecheck()
    }
  }, 2000)
}

function scheduleExtStatusRecheck() {
  clearTimeout(aiWsRecheckTimer)
  let retries = 0
  const maxRetries = 5
  function recheck() {
    if (retries >= maxRetries || dsConnectionStatus.value === 'connected') return
    retries++
    dsStatusText.value = `正在重连...(${retries}/${maxRetries})`
    // 通过 WS 发 recheck 消息让后端重新检查扩展状态
    if (aiWs?.readyState === WebSocket.OPEN) {
      aiWs.send('recheck')
    }
    // 2 秒后如果还没连上，再试一次
    aiWsRecheckTimer = setTimeout(() => {
      if (dsConnectionStatus.value !== 'connected') recheck()
    }, 2000)
  }
  recheck()
}

async function handleGenerate() {
  error.value = ''
  result.value = ''
  loading.value = true
  streamDone.value = false

  if (mode.value === 'continue') {
    await generateStream(
      {
        project_id: props.projectId,
        chapter_id: props.chapterId,
        prompt: prompt.value,
        temperature: temperature.value
      },
      (chunk) => { result.value += chunk },
      () => { streamDone.value = true; loading.value = false },
      (err) => { error.value = err; loading.value = false }
    )
  } else if (mode.value === 'rewrite') {
    try {
      const { data } = await generateApi.rewrite({
        project_id: props.projectId,
        chapter_id: props.chapterId,
        selected_text: selectedText.value,
        instruction: prompt.value,
        temperature: temperature.value
      })
      result.value = data.rewritten_text
    } catch (e) {
      if (e.response?.status === 429) {
        error.value = 'DeepSeek API 请求过于频繁（429），请等待 60 秒后再试'
      } else {
        error.value = e.response?.data?.detail || '改写失败'
      }
    } finally {
      loading.value = false
    }
  } else if (mode.value === 'suggestions') {
    try {
      const { data } = await generateApi.suggestions({
        project_id: props.projectId,
        chapter_id: props.chapterId
      })
      result.value = data.suggestions
    } catch (e) {
      if (e.response?.status === 429) {
        error.value = 'DeepSeek API 请求过于频繁（429），请等待 60 秒后再试'
      } else {
        error.value = e.response?.data?.detail || '获取建议失败'
      }
    } finally {
      loading.value = false
    }
  }
}

// ---- 生成设定 ----
async function handleGenerateSettings() {
  genError.value = ''
  genResult.value = ''
  genStreamingContent.value = ''
  genLoading.value = true
  genStreamDone.value = false

  // 如果勾选了附带项目设定，获取项目上下文
  let projectContext = ''
  if (genIncludeContext.value) {
    try {
      const { data: ctxData } = await importApi.getFullContext(props.projectId)
      projectContext = ctxData.context || ''
    } catch { }
  }

  const promptText = buildGeneratePrompt(
    genType.value,
    genModuleTypes.value,
    genUserHint.value,
    genImportMode.value,
    projectContext
  )

  try {
    const token = localStorage.getItem('access_token')
    const messages = [{ role: 'user', content: promptText }]

    const response = await fetch('/api/v1/free-deepseek/extension-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        messages,
        temperature: 0.7,
        project_id: props.projectId,
        include_context: false,
        is_continue: false
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(errText || `请求失败: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''
    let streamDone = false
    let _lastGenRenderTime = 0
    let _genRenderTimer = null
    const _t0 = Date.now()
    let _chunkCount = 0
    let _lastLogChunk = 0
    const _log = (msg) => console.log(`[AI_GEN +${((Date.now() - _t0) / 1000).toFixed(1)}s] ${msg}`)

    // 节流渲染函数：复用免费聊天的直接 DOM 操作模式
    function renderGenChunk(content) {
      const streamBox = document.querySelector('.gen-stream-content')
      if (streamBox) {
        // 流式输出时用轻量渲染，完成后才用完整 Markdown
        const rendered = genStreamDone.value ? cachedRenderMd(content) : lightRender(content)
        if (streamBox.innerHTML !== rendered) {
          streamBox.innerHTML = rendered
          // 强制同步重绘（解决背景标签页不刷新问题）
          const _h = streamBox.offsetHeight
        }
        // 自动滚动到底部
        streamBox.scrollTop = streamBox.scrollHeight
      }
    }

    // 节流调度：最多每 80ms 渲染一次
    function throttledRenderGen(content) {
      const now = performance.now()
      const elapsed = now - _lastGenRenderTime
      if (elapsed >= 80) {
        _lastGenRenderTime = now
        renderGenChunk(content)
      } else if (!_genRenderTimer) {
        _genRenderTimer = setTimeout(() => {
          _genRenderTimer = null
          _lastGenRenderTime = performance.now()
          renderGenChunk(content)
        }, 80 - elapsed)
      }
    }

    _log('🚀 开始读取 SSE 流...')

    // 直接读取流，不设前端超时（由扩展 DONE 信号 + 后端 grace period 控制结束时机）
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        _log(`✅ 流关闭, chunks=${_chunkCount}, contentLen=${fullContent.length}, streamDone=${streamDone}`)
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const dataStr = trimmed.slice(6)
        if (dataStr === '[DONE]') {
          streamDone = true
          _log(`📡 收到 [DONE] 标记`)
          continue
        }
        try {
          const data = JSON.parse(dataStr)
          if (data.type === 'ds_state' || data.type === 'waiting' || data.type === 'picked_up') continue
          if (data.content) {
            // 后端发的是累积内容（每次包含完整文本），直接赋值不叠加
            fullContent = data.content
            _chunkCount++
            // 每 50 个 chunk 打印一次，避免日志刷屏
            if (_chunkCount - _lastLogChunk >= 50 || _chunkCount <= 3) {
              _log(`📦 chunk #${_chunkCount}, len=${data.content.length}`)
              _lastLogChunk = _chunkCount
            }
            let display = fullContent
            if (display.trimEnd().endsWith('INCOMPLETE')) {
              display = display.trimEnd().slice(0, -'INCOMPLETE'.length).trimEnd()
            }
            genStreamingContent.value = display
            // ★ 如果放大弹窗已打开，同步更新弹窗内容（确保流式实时显示）
            if (expandModalVisible.value && expandSourceMsg.value) {
              expandSourceMsg.value.content = display
              // 同步更新 expandModalContent 作为兜底
              expandModalContent.value = display
            }
            // ★ 直接 DOM 操作 + 节流：复用免费聊天模式
            throttledRenderGen(display)
          }
          if (data.error) throw new Error(data.error)
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e
        }
      }
    }

    // 清理节流定时器
    if (_genRenderTimer) { clearTimeout(_genRenderTimer); _genRenderTimer = null }

    // 流式输出结束，立即更新 UI 状态
    genStreamDone.value = true
    genLoading.value = false
    _log(`🏁 流式结束, 耗时=${((Date.now() - _t0) / 1000).toFixed(1)}s, chunks=${_chunkCount}, contentLen=${fullContent.length}, streamDone=${streamDone}`)

    // 最终渲染一次完整 Markdown（替换轻量渲染）
    renderGenChunk(fullContent)

    // 如果放大弹窗仍然打开，最终更新一次完整 Markdown 内容
    if (expandModalVisible.value) {
      expandModalContent.value = fullContent
      if (expandSourceMsg.value) {
        expandSourceMsg.value.content = fullContent
      }
    }

    if (!fullContent) throw new Error('未收到 AI 回复，请重试')

    // 流式结束，尝试解析 JSON
    _log(`🔍 开始解析 JSON, contentLen=${fullContent.length}`)
    const jsonData = extractJSON(fullContent)
    if (!jsonData) {
      _log(`❌ JSON 解析失败, 总耗时=${((Date.now() - _t0) / 1000).toFixed(1)}s, 内容前200字: ${fullContent.slice(0, 200).replace(/\n/g, '\\n')}`)
      genResult.value = fullContent
      genStreamingContent.value = ''
      genError.value = 'AI 回复中未找到有效 JSON，请检查回复内容（已显示原始回复）'
      return
    }

    _log(`✅ JSON 解析成功, 总耗时=${((Date.now() - _t0) / 1000).toFixed(1)}s, keys=${Object.keys(jsonData).join(',')}`)
    const { valid } = validateImportData(jsonData)
    if (!valid) {
      _log(`❌ JSON 无有效数据, 总耗时=${((Date.now() - _t0) / 1000).toFixed(1)}s`)
      genResult.value = fullContent
      genStreamingContent.value = ''
      genError.value = 'JSON 中没有可导入的数据'
      return
    }

    // 显示预览，后台加载冲突检测（不阻塞 UI）
    genPreviewData.value = jsonData
    genStep.value = 'preview'
    _log(`🎉 全部完成, 总耗时=${((Date.now() - _t0) / 1000).toFixed(1)}s, 进入预览`)

    // 保存历史记录
    addGenHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      genType: genType.value,
      moduleTypes: [...genModuleTypes.value],
      userHint: genUserHint.value,
      importMode: genImportMode.value,
      includeContext: genIncludeContext.value,
      rawContent: fullContent,
      jsonData: jsonData,
      summary: buildHistorySummary(jsonData)
    })

    // 后台检测冲突（不阻塞 UI 更新）
    importApi.getProjectSettings(props.projectId).then(({ data: existing }) => {
      genConflicts.value = detectConflicts(jsonData, existing)
      for (const key of Object.keys(genConflicts.value)) {
        genClearFlags.value[key] = true
      }
    }).catch(() => {
      genConflicts.value = {}
    })

  } catch (e) {
    console.error(`[AI_GEN +${((Date.now() - _t0) / 1000).toFixed(1)}s] ❌ 异常:`, e.message)
    genError.value = e.message?.includes('429') ? '请求过于频繁，请等待后重试' : (e.message || '生成失败')
  } finally {
    genLoading.value = false
  }
}

async function confirmGenImport() {
  genLoading.value = true
  genError.value = ''
  try {
    // 追加模式：不清除任何已有数据；覆盖模式：按冲突检测结果清除
    const isAppend = genImportMode.value === 'append'
    const payload = {
      ...genPreviewData.value,
      clear_world_modules: isAppend ? false : genClearFlags.value.world_modules,
      clear_world_rules: isAppend ? false : genClearFlags.value.world_rules,
      clear_characters: isAppend ? false : genClearFlags.value.characters,
      clear_relationships: isAppend ? false : genClearFlags.value.relationships
    }
    const { data: result } = await importApi.importData(props.projectId, payload)

    const parts = []
    if (result.world_modules_created) parts.push(`${result.world_modules_created}个世界观`)
    if (result.world_rules_created) parts.push(`${result.world_rules_created}条规则`)
    if (result.characters_created) parts.push(`${result.characters_created}个角色`)
    if (result.relationships_created) parts.push(`${result.relationships_created}条关系`)

    genResult.value = `✅ 导入成功：${parts.join('、')}`
    if (result.errors?.length > 0) genResult.value += `\n⚠️ 部分失败：${result.errors.join('; ')}`

    genStep.value = 'config'
    genPreviewData.value = null
  } catch (e) {
    genError.value = e.message || '导入失败'
  } finally {
    genLoading.value = false
  }
}

function backToGenConfig() {
  genStep.value = 'config'
  genPreviewData.value = null
  genError.value = ''
  genResult.value = ''
  genStreamDone.value = false
}

function updatePreviewField(section, index, field, value) {
  if (genPreviewData.value?.[section]?.[index]) {
    genPreviewData.value[section][index][field] = value
  }
}

function removePreviewItem(section, index) {
  genPreviewData.value[section].splice(index, 1)
}

function formatCharacterMd(c) {
  const parts = [`# ${c.name || '角色'}`]
  if (c.gender) parts.push(`**性别：**${c.gender}`)
  if (c.age) parts.push(`**年龄：**${c.age}`)
  if (c.appearance) parts.push(`## 外貌\n${c.appearance}`)
  if (c.personality) parts.push(`## 性格\n${c.personality}`)
  if (c.abilities) parts.push(`## 能力\n${c.abilities}`)
  if (c.background) parts.push(`## 背景\n${c.background}`)
  if (c.status) parts.push(`**状态：**${c.status}`)
  if (c.quotes) parts.push(`## 语录\n${c.quotes}`)
  return parts.join('\n\n')
}

function toggleGenModuleType(type) {
  const idx = genModuleTypes.value.indexOf(type)
  if (idx >= 0) {
    genModuleTypes.value.splice(idx, 1)
  } else {
    genModuleTypes.value.push(type)
  }
}

// ====== 直连通道：前端 ↔ 扩展 ↔ DS ======
const directChannel = reactive({
  active: false,       // 是否正在使用直连模式
  chunkCount: 0,
  assistantMessage: ''
})

// 监听扩展直连消息
function onDirectMessage(event) {
  if (event.data?.type === 'NF_DIRECT_CHUNK') {
    if (!directChannel.active) return
    directChannel.chunkCount++
    // 去掉末尾的 INCOMPLETE 标记
    let content = event.data.content || ''
    if (content.trimEnd().endsWith('INCOMPLETE')) {
      content = content.trimEnd().slice(0, -'INCOMPLETE'.length).trimEnd()
    }
    directChannel.assistantMessage = content
    if (directChannel.chunkCount === 1) setStatus('💬 DeepSeek 正在回复...')
    // 节流渲染：最多每 80ms 渲染一次，避免每帧都解析 Markdown
    const now = performance.now()
    const elapsed = now - (directChannel._lastRenderTime || 0)
    if (elapsed >= 80) {
      directChannel._lastRenderTime = now
      renderDirectChunk()
    } else if (!directChannel._renderTimer) {
      directChannel._renderTimer = setTimeout(() => {
        directChannel._renderTimer = null
        directChannel._lastRenderTime = performance.now()
        renderDirectChunk()
      }, 80 - elapsed)
    }
  }
  if (event.data?.type === 'NF_DIRECT_DONE') {
    if (!directChannel.active) return
    directChannel.active = false
    // 清理节流定时器
    if (directChannel._renderTimer) { clearTimeout(directChannel._renderTimer); directChannel._renderTimer = null }
    // 最终渲染一次完整内容
    renderDirectChunk()
    chatLoading.value = false
    setStatus('✅ DeepSeek 回复完成')
    setTimeout(() => setStatus(''), 5000)
  }
  if (event.data?.type === 'NF_DIRECT_STATE') {
    if (!directChannel.active) return
    console.log('[NF_DIRECT] State:', event.data.state)
    if (event.data.state === 'continue') {
      setStatus('⏸️ 检测到DS输出暂停，请点击DS页面的继续生成按钮')
    } else if (event.data.state === 'generating') {
      setStatus('💬 DeepSeek 正在回复...')
    }
  }
  if (event.data?.type === 'NF_DIRECT_ERROR') {
    if (!directChannel.active) return
    console.log('[NF_DIRECT] Error:', event.data.error)
    directChannel.active = false
    chatLoading.value = false
    chatError.value = event.data.error || '直连通道错误'
    setStatus('❌ 错误: ' + (event.data.error || '未知'))
  }
}
window.addEventListener('message', onDirectMessage)

// 轻量渲染：流式输出时用纯文本+换行，避免每帧解析 Markdown
function lightRender(text) {
  if (!text) return ''
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
}

// 渲染直连 chunk（节流调用）
function renderDirectChunk() {
  const msg = directChannel.assistantMessage
  const lastMsg = chatMessages.value[chatMessages.value.length - 1]
  if (lastMsg?.role === 'assistant') {
    lastMsg.content = msg
    try {
      const container = document.querySelector('.chat-messages')
      if (container) {
        const streamDivs = container.querySelectorAll('.streaming-text')
        const lastStreamDiv = streamDivs[streamDivs.length - 1]
        if (lastStreamDiv) {
          // 流式输出时用轻量渲染，完成后才用完整 Markdown
          const rendered = directChannel.active ? lightRender(msg) : cachedRenderMd(msg)
          if (lastStreamDiv.innerHTML !== rendered) {
            lastStreamDiv.innerHTML = rendered
          }
        }
        // 只在用户接近底部时自动滚动
        const { scrollTop, scrollHeight, clientHeight } = container
        if (scrollHeight - scrollTop - clientHeight < 100) {
          container.scrollTop = scrollHeight
        }
      }
    } catch { }
  }
}

// 尝试通过直连通道发送
function tryDirectSend(content) {
  return new Promise((resolve) => {
    let resolved = false
    const handler = (event) => {
      if (event.data?.type === 'NF_DIRECT_ACK') {
        window.removeEventListener('message', handler)
        if (resolved) return
        resolved = true
        resolve(event.data)
      }
    }
    window.addEventListener('message', handler)
    window.postMessage({
      type: 'NF_DIRECT_CHAT_SEND',
      content,
      projectId: props.projectId,
      includeContext: includeContext.value,
      temperature: temperature.value
    }, '*')
    // 800ms 超时：扩展没响应则回退到 SSE
    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener('message', handler)
        resolved = true
        resolve({ ok: false, error: 'timeout' })
      }
    }, 800)
  })
}

async function handleChatSend() {
  if (!chatInput.value.trim() || chatLoading.value) return

  const userMessage = chatInput.value.trim()
  chatInput.value = ''
  chatError.value = ''

  chatMessages.value.push({ role: 'user', content: userMessage })
  autoScrollToBottom()

  chatLoading.value = true
  chatError.value = ''
  setStatus('📤 正在发送...')

  // 先尝试直连通道
  const directResult = await tryDirectSend(userMessage)
  if (directResult.ok) {
    console.log('[NF_FE] Using direct channel via extension bridge')
    setStatus('🔗 已通过扩展直连...')
    directChannel.active = true
    directChannel.chunkCount = 0
    directChannel.assistantMessage = ''
    chatMessages.value.push({ role: 'assistant', content: '' })
    autoScrollToBottom()
    return // 直连成功，后续数据通过 onDirectMessage 接收
  }

  // 直连失败，回退到 SSE
  console.log('[NF_FE] Direct channel unavailable, falling back to SSE')
  setStatus('📤 已发送到后端，等待扩展轮询...')

  try {
    const token = localStorage.getItem('access_token')
    const messages = chatMessages.value.map(m => ({ role: m.role, content: m.content }))

    setStatus('📤 已发送到后端，等待扩展轮询...')
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        messages,
        temperature: temperature.value,
        project_id: props.projectId,
        include_context: includeContext.value
      })
    })

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('DeepSeek 接口请求过于频繁（429），请等待 60 秒后再试')
      }
      const errText = await response.text()
      throw new Error(`请求失败: ${response.status} ${errText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let assistantMessage = ''

    chatMessages.value.push({ role: 'assistant', content: '' })
    autoScrollToBottom()
    let buffer = ''
    let eventCount = 0
    let chunkEventCount = 0
    let streamCompleted = false

    function processSseLine(dataStr) {
      if (dataStr === '[DONE]') {
        streamCompleted = true
        console.log('[NF_FE_SSE] Received [DONE]')
        setStatus('✅ DeepSeek 回复完毕')
        return
      }
      eventCount++
      try {
        const data = JSON.parse(dataStr)
        // 仅记录非 content 类型的事件（content 太多会刷屏）
        if (!data.content) {
          console.log('[NF_FE_SSE] event #' + eventCount + ':', data.type || 'data', data.state || '')
        }
        if (data.type === 'waiting') {
          extensionConnected.value = false
          setStatus('🔄 等待 DeepSeek 扩展响应...')
          chatError.value = data.message || '等待 DeepSeek 页面响应...'
        } else if (data.type === 'picked_up') {
          extensionConnected.value = true
          setStatus('📝 已转发到 DeepSeek 页面，正在输入...')
          chatError.value = ''
        } else if (data.type === 'ds_state') {
          console.log('[NF_FE_SSE] ds_state:', data.state)
          if (data.state === 'continue') {
            setStatus('⏸️ 检测到DS输出暂停，请点击DS页面的继续生成按钮')
          } else if (data.state === 'generating') {
            setStatus('💬 DeepSeek 正在回复...')
          }
        } else if (data.content) {
          if (chunkEventCount === 0) setStatus('💬 DeepSeek 正在回复...')
          chunkEventCount++
          extensionConnected.value = true
          chatError.value = ''
          assistantMessage = data.content
          const lastMsg = chatMessages.value[chatMessages.value.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = assistantMessage
            // ★ 直接 DOM 操作：绕过 Vue 异步渲染调度，解决背景标签页不渲染问题
            try {
              const streamContainer = document.querySelector('.chat-messages')
              if (streamContainer) {
                const streamDivs = streamContainer.querySelectorAll('.streaming-text')
                const lastStreamDiv = streamDivs[streamDivs.length - 1]
                if (lastStreamDiv) {
                  const rendered = cachedRenderMd(assistantMessage)
                  if (lastStreamDiv.innerHTML !== rendered) {
                    lastStreamDiv.innerHTML = rendered
                    // 强制同步重绘
                    const _h = lastStreamDiv.offsetHeight
                  }
                }
              }
            } catch { }
          }
          if (data.filtered) {
            setStatus('⚠️ 检测到内容审核已自动拦截，已保留原始回复')
            chatError.value = '（DeepSeek 触发了内容审核，已保留原始回复）'
          }
          autoScrollToBottom()
        } else if (data.error) {
          chatError.value = data.code === 429
            ? `请求过于频繁，请等待 ${data.retry_after || 60} 秒后重试`
            : data.error
          setStatus('❌ 出错: ' + data.error)
        }
      } catch { }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('[NF_FE_SSE] reader.read() done=true, streamCompleted=' + streamCompleted + ', chunks=' + chunkEventCount + ', msgLen=' + assistantMessage.length)
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data: ')) {
          processSseLine(trimmed.slice(6))
        } else if (trimmed.startsWith(':')) {
          // keepalive comment from backend
          console.log('[NF_FE_SSE] keepalive comment received')
        }
      }
    }

    // 流结束处理（后端已在 done 后保持 30 秒窗口等待 DS 继续生成）
    console.log('[NF_FE_SSE] Stream ended, streamCompleted=' + streamCompleted + ', hasContent=' + !!assistantMessage)
    chatLoading.value = false
    autoScrollToBottom()
    if (!chatError.value) {
      if (streamCompleted) {
        setStatus('✅ DeepSeek 回复完成')
      } else if (assistantMessage) {
        setStatus('⚠️ 连接中断，回复可能不完整')
        chatError.value = '连接意外中断，回复可能不完整'
      }
      setTimeout(() => { setStatus('') }, 5000)
    }
  } catch (e) {
    chatError.value = e.message || '发送失败'
    chatLoading.value = false
    setStatus('❌ 错误: ' + (e.message || '发送失败'))
    chatMessages.value.push({ role: 'assistant', content: '抱歉，发生了错误: ' + (e.message || '未知错误') })
    autoScrollToBottom()
  }
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleChatSend()
  }
}

function handleInsert() {
  emit('insert', result.value)
  result.value = ''
}

function handleStop() {
  loading.value = false
  streamDone.value = true
}

function scrollToBottom() {
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

function autoScrollToBottom() {
  nextTick(scrollToBottom)
}


function scrollCookieToBottom() {
  if (cookieContainer.value) {
    cookieContainer.value.scrollTop = cookieContainer.value.scrollHeight
  }
}

function autoScrollCookieToBottom() {
  if (!showCookieScrollToBottom.value) {
    nextTick(scrollCookieToBottom)
  }
}

// ---- 拖拽调整宽度（纯 DOM，零 Vue 重渲染） ----
const drawerEl = ref(null)
const drawerWidth = ref(420)
const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.6
let dragActive = false
let startX = 0
let startWidth = 0
let dragOverlay = null

function onDragStart(e) {
  dragActive = true
  startX = e.clientX
  startWidth = drawerWidth.value
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  drawerEl.value.classList.add('dragging')

  // 冻结聊天区域：直接操作 DOM，不触发 Vue
  const wrapper = drawerEl.value?.querySelector('.chat-messages-wrapper')
  if (wrapper) {
    wrapper.classList.add('frozen')
    dragOverlay = document.createElement('div')
    dragOverlay.className = 'drag-freeze-overlay'
    wrapper.prepend(dragOverlay)
  }

  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e) {
  if (!dragActive) return
  const delta = startX - e.clientX
  const maxW = window.innerWidth * MAX_WIDTH_RATIO
  let newWidth = startWidth + delta
  if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH
  if (newWidth > maxW) newWidth = maxW
  drawerEl.value.style.width = newWidth + 'px'
}

function onDragEnd(e) {
  if (!dragActive) return
  dragActive = false
  const delta = startX - e.clientX
  const maxW = window.innerWidth * MAX_WIDTH_RATIO
  let newWidth = startWidth + delta
  if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH
  if (newWidth > maxW) newWidth = maxW

  // 同步 reactive 状态（仅一次）
  drawerWidth.value = newWidth
  drawerEl.value.style.width = newWidth + 'px'

  // 解冻：直接操作 DOM
  drawerEl.value.classList.remove('dragging')
  const wrapper = drawerEl.value?.querySelector('.chat-messages-wrapper')
  if (wrapper) wrapper.classList.remove('frozen')
  if (dragOverlay) { dragOverlay.remove(); dragOverlay = null }

  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}
</script>

<template>
  <!-- 遮罩层 -->
  <div class="ai-drawer-overlay" @click="$emit('close')"></div>
  <!-- 抽屉 -->
  <aside ref="drawerEl" class="ai-drawer" :style="{ width: drawerWidth + 'px' }" @click.stop>
    <!-- 拖拽条 -->
    <div class="drawer-resize-handle" @mousedown.prevent="onDragStart">
      <div class="resize-indicator"></div>
    </div>

    <div class="drawer-inner">
      <div class="panel-header">
        <span class="panel-title">AI 助手</span>
        <div v-if="mode === 'free-chat'" class="header-center">
          <span class="header-ds-title">DeepSeek</span>
          <span class="header-status-dot" :class="dsConnectionStatus"></span>
          <span v-if="dsConnectionStatus === 'disconnected' || dsConnectionStatus === 'no-extension'"
            class="header-status-hint" @click="switchTabHint">断开，点击重连</span>
        </div>
        <button class="btn-close" @click="$emit('close')">&times;</button>
      </div>

      <!-- Mode Tabs -->
      <div class="mode-tabs">
        <button :class="{ active: mode === 'continue' }" @click="mode = 'continue'">续写</button>
        <button :class="{ active: mode === 'rewrite' }" @click="mode = 'rewrite'">改写</button>
        <button :class="{ active: mode === 'suggestions' }" @click="mode = 'suggestions'">建议</button>
        <button :class="{ active: mode === 'free-chat' }" @click="mode = 'free-chat'">免费聊天</button>
        <button :class="{ active: mode === 'generate' }" @click="mode = 'generate'">生成设定</button>
      </div>

      <!-- Input Area -->
      <div class="panel-body">
        <!-- Rewrite: selected text -->
        <div v-if="mode === 'rewrite'" class="form-group">
          <label>选中的文本</label>
          <textarea v-model="selectedText" placeholder="粘贴需要改写的文本..." rows="4"></textarea>
        </div>

        <!-- Prompt input (continue/rewrite only) -->
        <div v-if="mode === 'continue' || mode === 'rewrite'" class="form-group">
          <label>{{ mode === 'continue' ? '续写提示' : '改写要求' }}</label>
          <textarea v-model="prompt" :placeholder="mode === 'continue' ? '描述你想要的剧情发展...' : '例如：让这段文字更加生动...'"
            rows="3"></textarea>
        </div>

        <!-- Temperature (continue/rewrite only) -->
        <div v-if="mode === 'continue' || mode === 'rewrite'" class="form-group">
          <label>温度: {{ temperature }}</label>
          <input type="range" v-model.number="temperature" min="0" max="1" step="0.1" />
        </div>

        <!-- Generate/Stop button (continue/rewrite/suggestions only) -->
        <div v-if="mode === 'continue' || mode === 'rewrite' || mode === 'suggestions'" class="action-row">
          <button v-if="!loading" class="btn-primary" @click="handleGenerate">{{ mode === 'suggestions' ? '获取建议' : '生成'
          }}</button>
          <button v-else class="btn-secondary" @click="handleStop">停止</button>
        </div>

        <!-- Error -->
        <p v-if="error" class="error">{{ error }}</p>

        <!-- Free Chat Mode -->
        <div v-show="mode === 'free-chat'" class="free-chat-container">

          <div class="chat-messages-wrapper">
            <div class="chat-messages" ref="chatContainer">
              <div v-if="chatMessages.length === 0" class="chat-empty">
                开始与 DeepSeek 免费版对话吧！<br />
                <small style="color:var(--text-secondary)">请确保已打开 chat.deepseek.com 并登录</small>
              </div>
              <button v-if="hasMoreMessages" class="btn-load-more" @click="loadMoreMessages">加载更早的 {{ Math.min(50,
                chatMessages.length - visibleCount) }} 条消息</button>
              <div v-for="(msg, idx) in visibleChatMessages"
                :key="chatMessages.length - visibleChatMessages.length + idx" :class="['chat-message', msg.role]"
                @contextmenu="onMsgContextMenu($event, msg, chatMessages.length - visibleChatMessages.length + idx)">
                <div class="chat-message-header">
                  <div class="chat-message-role">{{ msg.role === 'user' ? '用户' : 'DeepSeek' }}</div>
                  <button v-if="msg.role === 'assistant' && msg.content" class="btn-expand" @click="expandMessage(msg)"
                    title="放大查看">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                      stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <polyline points="9 21 3 21 3 15"></polyline>
                      <line x1="21" y1="3" x2="14" y2="10"></line>
                      <line x1="3" y1="21" x2="10" y2="14"></line>
                    </svg>
                  </button>
                </div>
                <div v-if="msg.role === 'user'" class="chat-message-content" @dblclick="expandMessage(msg)">{{
                  msg.content }}</div>
                <div v-else class="chat-message-content" @dblclick="expandMessage(msg)">
                  <div v-if="chatLoading && idx === visibleChatMessages.length - 1 && !msg.content"
                    class="loading-dots">
                    <span></span><span></span><span></span>
                  </div>
                  <div v-else-if="chatLoading && idx === visibleChatMessages.length - 1"
                    class="streaming-text rendered-md" v-html="cachedRenderMd(msg.content)"></div>
                  <div v-else class="rendered-md rendered-fade" v-html="cachedRenderMd(msg.content)"></div>
                </div>
              </div>
            </div>
            <ScrollButton :scroll-container="chatContainer" :bottom="6" :right="13" :size="28" />
          </div>

          <p v-if="chatError" class="error">{{ chatError }}</p>
          <span v-if="chatStatusMsg" class="status-msg">{{ chatStatusMsg }}</span>

          <div class="chat-input-box">
            <textarea v-model="chatInput" @keydown="handleChatKeydown" placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows="2" :disabled="chatLoading"></textarea>
            <div class="chat-input-bottom">
              <label class="context-toggle-label">
                <input type="checkbox" v-model="includeContext" />
                <span>设定</span>
              </label>
              <button class="btn-send" @click="handleChatSend" :disabled="chatLoading || !chatInput.trim()" title="发送">
                <span v-if="!chatLoading" class="send-icon">&#9650;</span>
                <span v-else class="send-loading">...</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Generate Settings Mode -->
        <div v-if="mode === 'generate'" class="gen-container">

          <!-- Step 1: 配置 -->
          <template v-if="genStep === 'config'">
            <!-- 历史记录 -->
            <div class="gen-history-bar">
              <button class="gen-history-toggle" @click="showHistory = !showHistory">
                📋 历史记录 ({{ genHistory.length }})
              </button>
            </div>
            <div v-if="showHistory" class="gen-history-panel">
              <div v-if="genHistory.length === 0" class="gen-history-empty">
                暂无历史记录
              </div>
              <div v-for="record in genHistory" :key="record.id" class="gen-history-item">
                <div class="gen-history-item-header">
                  <span class="gen-history-type">{{ GENERATE_TYPES[record.genType] || record.genType }}</span>
                  <span class="gen-history-time">{{ formatGenTime(record.timestamp) }}</span>
                  <button class="gen-history-delete" @click="deleteGenHistory(record.id)" title="删除">×</button>
                </div>
                <div class="gen-history-summary">{{ record.summary }}</div>
                <div v-if="record.userHint" class="gen-history-hint">"{{ record.userHint }}"</div>
                <button class="gen-history-restore" @click="restoreGenHistory(record)">恢复此记录</button>
              </div>
              <button v-if="genHistory.length > 0" class="gen-history-clear" @click="clearGenHistory">
                清空全部历史
              </button>
            </div>

            <div class="gen-section">
              <label class="gen-label">生成类型</label>
              <div class="gen-type-row">
                <button v-for="(label, key) in GENERATE_TYPES" :key="key"
                  :class="['gen-type-btn', { active: genType === key }]" @click="genType = key">{{ label }}</button>
              </div>
            </div>

            <div v-if="genType === 'world' || genType === 'all'" class="gen-section">
              <label class="gen-label">世界观模块</label>
              <div class="gen-modules">
                <label v-for="(label, key) in MODULE_LABELS" :key="key" class="gen-module-check">
                  <input type="checkbox" :checked="genModuleTypes.includes(key)" @change="toggleGenModuleType(key)" />
                  <span>{{ label }}</span>
                </label>
              </div>
            </div>

            <div class="gen-section">
              <label class="gen-label">补充说明（可选）</label>
              <textarea v-model="genUserHint" class="gen-textarea" placeholder="描述你想要的设定风格、背景、要求..."
                rows="3"></textarea>
            </div>

            <label class="gen-context-toggle">
              <input type="checkbox" v-model="genIncludeContext" />
              <span>附带项目设定（世界观、角色、规则、最近章节）</span>
            </label>

            <div class="gen-section">
              <label class="gen-label">导入模式</label>
              <div class="gen-type-row">
                <button :class="['gen-type-btn', { active: genImportMode === 'overwrite' }]"
                  @click="genImportMode = 'overwrite'">覆盖已有</button>
                <button :class="['gen-type-btn', { active: genImportMode === 'append' }]"
                  @click="genImportMode = 'append'">补充追加</button>
              </div>
              <div class="gen-mode-hint">
                {{ genImportMode === 'overwrite' ? '将清除已有同类数据后导入（可在预览中勾选要清除的类型）' : '直接追加到现有数据，不删除任何内容' }}
              </div>
            </div>

            <!-- 流式输出窗口 -->
            <div v-if="genStreamingContent || genResult" class="gen-stream-box">
              <div class="gen-stream-header">
                <span :class="{ 'stream-pulsing': !genStreamDone || genLoading }">
                  {{ genStreamDone ? '✅ 生成完成' : '⏳AI正在生成' }}</span>
                <button class="gen-stream-expand"
                  @click="openExpandModal('AI 生成结果', genStreamingContent || genResult, { content: genStreamingContent })"
                  title="放大查看">⤢</button>
              </div>
              <!-- 流式输出时由 renderGenChunk 直接操作 DOM，完成后由 v-html 渲染 -->
              <div v-if="genStreamDone" class="gen-stream-content rendered-md"
                v-html="cachedRenderMd(genStreamingContent || genResult || '')"
                @dblclick="openExpandModal('AI 生成结果', genStreamingContent || genResult, { content: genStreamingContent })">
              </div>
              <div v-else class="gen-stream-content rendered-md"
                @dblclick="openExpandModal('AI 生成结果', genStreamingContent || genResult, { content: genStreamingContent })">
              </div>
            </div>

            <button class="btn-primary" :disabled="genLoading" @click="handleGenerateSettings">
              {{ genLoading ? '生成中...' : '开始生成' }}
            </button>

            <p v-if="genError" class="error">{{ genError }}</p>
          </template>

          <!-- Step 2: 预览 -->
          <template v-if="genStep === 'preview' && genPreviewData">
            <div class="gen-preview-header">
              <button class="gen-back-btn" @click="backToGenConfig">← 返回</button>
              <span class="gen-preview-title">预览 · {{ genImportMode === 'append' ? '补充追加' : '覆盖导入' }}</span>
              <div class="gen-view-toggle">
                <button :class="{ active: genPreviewMode === 'render' }" @click="genPreviewMode = 'render'">渲染</button>
                <button :class="{ active: genPreviewMode === 'json' }" @click="genPreviewMode = 'json'">JSON</button>
              </div>
            </div>

            <!-- 冲突提示 -->
            <div v-if="genImportMode === 'overwrite' && Object.keys(genConflicts).length > 0" class="gen-conflicts">
              <div class="gen-conflict-title">⚠️ 检测到已有设定冲突</div>
              <div v-for="(msg, key) in genConflicts" :key="key" class="gen-conflict-item">
                <label class="gen-conflict-label">
                  <input type="checkbox" v-model="genClearFlags[key]" />
                  <span>{{ GENERATE_TYPES[key] || key }}：{{ msg }}</span>
                </label>
              </div>
            </div>

            <!-- JSON 视图 -->
            <div v-if="genPreviewMode === 'json'" class="gen-json-view">
              <pre>{{ JSON.stringify(genPreviewData, null, 2) }}</pre>
            </div>

            <!-- 渲染视图 -->
            <div v-else class="gen-preview-content">
              <!-- 世界观模块 -->
              <div v-if="genPreviewData.world_modules?.length" class="gen-preview-section">
                <div class="gen-preview-section-title">世界观模块（{{ genPreviewData.world_modules.length }}）</div>
                <div v-for="(m, i) in genPreviewData.world_modules" :key="'wm' + i" class="gen-card">
                  <div class="gen-card-header" @dblclick="openExpandModal(m.title || '世界观模块', m.content || '')">
                    <span class="gen-tag">{{ MODULE_LABELS[m.module_type] || m.module_type }}</span>
                    <input class="gen-card-title-input" :value="m.title"
                      @input="updatePreviewField('world_modules', i, 'title', $event.target.value)" />
                    <button class="gen-card-expand" @click="openExpandModal(m.title || '世界观模块', m.content || '')"
                      title="放大查看">⤢</button>
                    <button class="gen-card-remove" @click="removePreviewItem('world_modules', i)" title="删除">×</button>
                  </div>
                  <div class="gen-card-preview rendered-md" v-html="cachedRenderMd(m.content || '')"
                    @dblclick="openExpandModal(m.title || '世界观模块', m.content || '')"></div>
                  <textarea class="gen-card-content" :value="m.content"
                    @input="updatePreviewField('world_modules', i, 'content', $event.target.value)" rows="3"></textarea>
                </div>
              </div>

              <!-- 硬规则 -->
              <div v-if="genPreviewData.world_rules?.length" class="gen-preview-section">
                <div class="gen-preview-section-title">硬规则（{{ genPreviewData.world_rules.length }}）</div>
                <div v-for="(r, i) in genPreviewData.world_rules" :key="'wr' + i" class="gen-card">
                  <div class="gen-card-header">
                    <span class="gen-tag">P{{ r.priority }}</span>
                    <textarea class="gen-card-content" style="flex:1" :value="r.content"
                      @input="updatePreviewField('world_rules', i, 'content', $event.target.value)" rows="1"></textarea>
                    <button class="gen-card-remove" @click="removePreviewItem('world_rules', i)" title="删除">×</button>
                  </div>
                </div>
              </div>

              <!-- 角色 -->
              <div v-if="genPreviewData.characters?.length" class="gen-preview-section">
                <div class="gen-preview-section-title">角色（{{ genPreviewData.characters.length }}）</div>
                <div v-for="(c, i) in genPreviewData.characters" :key="'ch' + i" class="gen-card">
                  <div class="gen-card-header" @dblclick="openExpandModal(c.name || '角色', formatCharacterMd(c))">
                    <input class="gen-card-title-input" style="font-weight:600" :value="c.name"
                      @input="updatePreviewField('characters', i, 'name', $event.target.value)" />
                    <span class="gen-tag">{{ c.gender || '' }} {{ c.age || '' }}</span>
                    <button class="gen-card-expand" @click="openExpandModal(c.name || '角色', formatCharacterMd(c))"
                      title="放大查看">⤢</button>
                    <button class="gen-card-remove" @click="removePreviewItem('characters', i)" title="删除">×</button>
                  </div>
                  <div class="gen-card-attrs">
                    <div v-if="c.personality" class="gen-attr"><b>性格：</b>{{ c.personality }}</div>
                    <div v-if="c.appearance" class="gen-attr"><b>外貌：</b>{{ c.appearance }}</div>
                    <div v-if="c.background" class="gen-attr"><b>背景：</b>{{ c.background }}</div>
                    <div v-if="c.abilities" class="gen-attr"><b>能力：</b>{{ c.abilities }}</div>
                  </div>
                </div>
              </div>

              <!-- 关系 -->
              <div v-if="genPreviewData.relationships?.length" class="gen-preview-section">
                <div class="gen-preview-section-title">角色关系（{{ genPreviewData.relationships.length }}）</div>
                <div v-for="(r, i) in genPreviewData.relationships" :key="'rl' + i" class="gen-card gen-card-rel">
                  <span class="gen-rel-name">{{ r.from_name }}</span>
                  <input class="gen-rel-input" :value="r.relation_type"
                    @input="updatePreviewField('relationships', i, 'relation_type', $event.target.value)"
                    placeholder="关系类型" />
                  <span class="gen-rel-name">{{ r.to_name }}</span>
                  <div class="gen-rel-intimacy-edit">
                    <label>亲密度</label>
                    <input type="number" min="0" max="100" :value="r.intimacy"
                      @input="updatePreviewField('relationships', i, 'intimacy', Number($event.target.value))" />
                  </div>
                  <button class="gen-card-remove" @click="removePreviewItem('relationships', i)" title="删除">×</button>
                </div>
              </div>
            </div>

            <button class="btn-primary" :disabled="genLoading" @click="confirmGenImport">
              {{ genLoading ? '导入中...' : '确认导入' }}
            </button>

            <p v-if="genError" class="error">{{ genError }}</p>
            <div v-if="genResult" class="gen-result">{{ genResult }}</div>
          </template>
        </div>

        <!-- Result (非生成设定模式) -->
        <div v-if="result && mode !== 'generate'" class="result-section">
          <div class="result-header">
            <span>生成结果</span>
            <button class="btn-insert" @click="handleInsert">插入到编辑器</button>
          </div>
          <StreamText v-if="loading && !streamDone" :text="result" />
          <div v-else class="result-text">{{ result }}</div>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div v-if="contextMenu.visible" class="ctx-menu-overlay" @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu">
        <div class="ctx-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }">
          <div class="ctx-menu-item" @click="ctxExpand">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            <span>放大查看</span>
          </div>
          <div class="ctx-menu-item" @click="ctxCopy">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            <span>复制内容</span>
          </div>
          <div class="ctx-menu-item ctx-menu-import" @click="ctxImport">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>导入到编辑器</span>
          </div>
          <div class="ctx-menu-item ctx-menu-danger" @click="ctxDelete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            <span>删除消息</span>
          </div>
        </div>
      </div>

      <!-- Toast 提示 -->
      <transition name="toast-fade">
        <div v-if="toast.visible" class="toast">{{ toast.text }}</div>
      </transition>
    </teleport>

    <!-- 聊天消息放大 -->
    <MdPreviewModal :visible="showExpandModal && !!expandedMessage" title="AI 回复详情"
      :content="expandedMessage?.content || ''" @close="closeExpandModal" />
    <!-- 通用放大（预览内容，支持流式实时更新） -->
    <MdPreviewModal :visible="expandModalVisible" :title="expandModalTitle"
      :content="expandSourceMsg?.content || expandModalContent" @close="closeGenericExpandModal" />
  </aside>
</template>

<style scoped>
/* ---- 抽屉容器 ---- */
.ai-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(0, 0, 0, 0.15);
}

.ai-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 901;
  background: var(--bg-card);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  will-change: width;
}

.ai-drawer.dragging,
.ai-drawer.dragging * {
  transition: none !important;
  animation: none !important;
}

.drawer-inner {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ---- 拖拽条 ---- */
.drawer-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.drawer-resize-handle:hover,
.drawer-resize-handle:active {
  background: transparent;
}

.resize-indicator {
  width: 2px;
  height: 32px;
  border-radius: 1px;
  background: var(--border);
  transition: background 0.15s, height 0.15s;
}

.drawer-resize-handle:hover .resize-indicator,
.drawer-resize-handle:active .resize-indicator {
  background: var(--primary);
  height: 48px;
}

/* ---- Header ---- */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.2px;
}

.header-center {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.header-ds-title {
  color: var(--text-secondary);
  font-weight: 500;
}

.header-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #eab308;
}

.header-status-dot.connected {
  background: #22c55e;
}

.header-status-dot.disconnected,
.header-status-dot.no-extension {
  background: #ef4444;
}

.header-status-hint {
  color: #ef4444;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
}

.header-status-hint:hover {
  opacity: 0.8;
}

.btn-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: color 0.15s;
}

.btn-close:hover {
  color: var(--text);
}

/* ---- Mode Tabs ---- */
.mode-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}

.mode-tabs button {
  flex: 1;
  padding: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.mode-tabs button.active {
  color: var(--text);
  border-bottom-color: var(--text);
  font-weight: 500;
}

/* ---- Body ---- */
.panel-body {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  min-height: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.form-group label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-group textarea {
  resize: vertical;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  transition: border-color 0.15s;
}

.form-group textarea:focus {
  outline: none;
  border-color: var(--primary);
}

.form-group input[type="range"] {
  width: 100%;
  accent-color: var(--text);
}

.action-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.btn-primary {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-primary:active {
  transform: scale(0.98);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-secondary {
  flex: 1;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin: 0 0 12px 0;
}

/* ---- Result ---- */
.result-section {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-hover);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.btn-insert {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--text);
  color: var(--bg-card);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-insert:hover {
  opacity: 0.8;
}

.result-text {
  padding: 12px;
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
}

/* ---- Free Chat ---- */
.free-chat-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  height: 100%;
}

/* ---- 生成设定 ---- */
.gen-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gen-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gen-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.gen-type-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.gen-type-btn {
  flex: 1;
  min-width: 0;
  padding: 8px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.gen-type-btn.active {
  background: var(--text);
  color: var(--bg-card);
  border-color: var(--text);
}

.gen-type-btn:hover:not(.active) {
  background: var(--bg-hover);
}

.gen-modules {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.gen-module-check {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.gen-module-check input {
  cursor: pointer;
  accent-color: var(--primary);
}

.gen-textarea {
  resize: vertical;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  transition: border-color 0.15s;
}

.gen-textarea:focus {
  outline: none;
  border-color: var(--primary);
}

.gen-context-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.gen-context-toggle input {
  cursor: pointer;
  accent-color: var(--primary);
}

.gen-mode-hint {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
  margin-top: 2px;
}

/* ---- 生成设定历史记录 ---- */
.gen-history-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 4px;
}

.gen-history-toggle {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.gen-history-toggle:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.gen-history-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 8px;
}

.gen-history-empty {
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 20px;
}

.gen-history-item {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  transition: background 0.12s;
}

.gen-history-item:last-child {
  border-bottom: none;
}

.gen-history-item:hover {
  background: var(--bg-hover);
}

.gen-history-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.gen-history-type {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.gen-history-time {
  font-size: 11px;
  color: var(--text-secondary);
  flex: 1;
}

.gen-history-delete {
  background: none;
  border: none;
  font-size: 16px;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 0.12s;
  padding: 0 4px;
}

.gen-history-delete:hover {
  opacity: 1;
  color: #ef4444;
}

.gen-history-summary {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.gen-history-hint {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
  font-style: italic;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gen-history-restore {
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 11px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.gen-history-restore:hover {
  opacity: 0.85;
}

.gen-history-clear {
  width: 100%;
  padding: 8px;
  background: none;
  border: none;
  color: #ef4444;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.gen-history-clear:hover {
  opacity: 0.7;
}

.gen-result {
  padding: 10px 12px;
  background: rgba(22, 163, 74, 0.08);
  border: 1px solid rgba(22, 163, 74, 0.2);
  border-radius: 6px;
  font-size: 13px;
  color: #16a34a;
  white-space: pre-wrap;
  line-height: 1.6;
}

/* 流式输出框 */
.gen-stream-box {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-top: 8px;
}

.gen-stream-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--bg-hover);
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}

.gen-stream-header span.stream-pulsing {
  animation: pulse 1.5s ease-in-out infinite;
}

.gen-stream-expand {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.gen-stream-expand:hover {
  opacity: 1;
  color: var(--primary);
}

.gen-stream-content {
  padding: 12px;
  font-size: 13px;
  line-height: 1.7;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- 预览面板 ---- */
.gen-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.gen-back-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 0;
}

.gen-back-btn:hover {
  color: var(--text);
}

.gen-preview-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
}

.gen-view-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.gen-view-toggle button {
  padding: 3px 10px;
  border: none;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.12s;
}

.gen-view-toggle button.active {
  background: var(--text);
  color: var(--bg-card);
}

.gen-conflicts {
  padding: 8px 10px;
  background: rgba(234, 179, 8, 0.08);
  border: 1px solid rgba(234, 179, 8, 0.25);
  border-radius: 6px;
}

.gen-conflict-title {
  font-size: 12px;
  font-weight: 600;
  color: #d97706;
  margin-bottom: 6px;
}

.gen-conflict-item {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 3px;
}

.gen-conflict-label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.gen-conflict-label input {
  accent-color: #d97706;
}

.gen-json-view {
  max-height: 300px;
  overflow-y: auto;
  background: #1f2937;
  border-radius: 6px;
  padding: 10px;
}

.gen-json-view pre {
  color: #e5e7eb;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.gen-preview-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 400px;
  overflow-y: auto;
}

.gen-preview-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 6px;
}

.gen-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--bg-card);
}

.gen-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.gen-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}

.gen-card-title-input {
  flex: 1;
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  color: var(--text);
  outline: none;
  min-width: 0;
}

.gen-card-title-input:focus {
  border-color: var(--border);
  background: var(--bg);
}

.gen-card-remove {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.4;
  transition: opacity 0.12s;
}

.gen-card-remove:hover {
  opacity: 1;
  color: #ef4444;
}

.gen-card-content {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 4px 6px;
  font-size: 12px;
  line-height: 1.5;
  background: transparent;
  color: var(--text-secondary);
  resize: vertical;
  outline: none;
  font-family: inherit;
}

.gen-card-content:focus {
  border-color: var(--border);
  background: var(--bg);
}

.gen-card-preview {
  padding: 6px 8px;
  margin-bottom: 4px;
  max-height: 120px;
  overflow-y: auto;
  border-radius: 4px;
  background: var(--bg-hover);
  cursor: pointer;
  font-size: 12px;
  line-height: 1.6;
}

.gen-card-preview:hover {
  background: var(--bg);
}

.gen-card-expand {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.4;
  transition: opacity 0.12s;
}

.gen-card-expand:hover {
  opacity: 1;
  color: var(--primary);
}

.gen-card-attrs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-secondary);
}

.gen-attr {
  line-height: 1.5;
}

.gen-attr b {
  font-weight: 500;
  color: var(--text);
}

.gen-card-rel {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.gen-rel-name {
  font-weight: 500;
  font-size: 13px;
}

.gen-rel-type {
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
}

.gen-rel-input {
  width: 80px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  background: var(--bg-card);
  color: var(--text);
  text-align: center;
}

.gen-rel-input:focus {
  outline: none;
  border-color: var(--primary);
}

.gen-rel-intimacy {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: auto;
}

.gen-rel-intimacy-edit {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary);
}

.gen-rel-intimacy-edit input {
  width: 50px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  background: var(--bg-card);
  color: var(--text);
  text-align: center;
}

.gen-rel-intimacy-edit input:focus {
  outline: none;
  border-color: var(--primary);
}

.chat-sync-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin-bottom: 8px;
  background: var(--bg-hover);
  border-radius: 6px;
  font-size: 12px;
}

.context-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.context-toggle input {
  cursor: pointer;
}

.context-toggle-inline {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  padding: 4px 0;
  margin-bottom: 6px;
}

.context-toggle-inline input {
  cursor: pointer;
  accent-color: var(--primary);
}

.sync-text {
  flex: 1;
  color: var(--text-secondary);
}

.status-msg {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg);
  white-space: nowrap;
}

.sync-hint {
  font-size: 11px;
  color: var(--primary);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

.chat-messages-wrapper {
  position: relative;
  flex: 1;
  min-height: 0;
}

.drag-freeze-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  cursor: col-resize;
}

.chat-messages-wrapper.frozen .chat-messages {
  pointer-events: none;
  overflow: hidden;
}

.chat-messages {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px;
  background: var(--bg-hover);
  border-radius: 8px;
  min-width: 0;
}



.chat-empty {
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 20px 0;
}

.btn-load-more {
  display: block;
  width: 100%;
  padding: 6px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: background 0.15s, color 0.15s;
}

.btn-load-more:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 8px;
  max-width: 90%;
}

.chat-message.user {
  align-self: flex-end;
  background: var(--primary);
  color: white;
}

.chat-message.assistant {
  align-self: flex-start;
  background: var(--bg);
  border: 1px solid var(--border);
}

.chat-message-role {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
}

.chat-message-content {
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
  border-radius: 4px;
  transition: outline 0.15s;
}

.streaming-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.rendered-fade {
  animation: fadeRender 0.3s ease;
}

@keyframes fadeRender {
  from {
    opacity: 0.6;
  }

  to {
    opacity: 1;
  }
}

.loading-dots {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.loading-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-secondary, #737373);
  animation: dotBounce 1.2s ease-in-out infinite;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dotBounce {

  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }

  40% {
    opacity: 1;
    transform: scale(1);
  }
}

.chat-input-box {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  transition: border-color 0.15s;
  overflow: hidden;
  min-width: 0;
}

.chat-input-box:focus-within {
  border-color: var(--primary);
}

.chat-input-box textarea {
  flex: 1;
  padding: 10px 12px;
  border: none;
  border-radius: 0;
  font-size: 13px;
  resize: none;
  font-family: inherit;
  background: transparent;
  color: var(--text);
  outline: none;
  line-height: 1.5;
  min-width: 0;
  min-height: 44px;
}

.chat-input-box textarea::placeholder {
  color: var(--text-secondary);
  opacity: 0.6;
}

.chat-input-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 4px 8px;
  border-top: 1px solid var(--border);
  gap: 8px;
}

.context-toggle-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.context-toggle-label input {
  cursor: pointer;
  accent-color: var(--primary);
  margin: 0;
}

.btn-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  min-width: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #000;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  flex-shrink: 0;
}

.btn-send:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn-send:active:not(:disabled) {
  transform: scale(0.9);
}

.btn-send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.send-icon {
  font-size: 14px;
  color: #000;
  pointer-events: none;
}

.send-loading {
  font-size: 12px;
  letter-spacing: 1px;
  animation: blink 1s infinite;
}

.cookie-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s;
}

.btn-sm:hover {
  background: var(--bg-hover);
}

.chat-message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.btn-expand {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: var(--text-secondary);
  opacity: 0.5;
  transition: opacity 0.15s, color 0.15s;
  display: flex;
  align-items: center;
}

.btn-expand:hover {
  opacity: 1;
  color: var(--text);
}


/* ---- Expand Modal ---- */
.expand-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.expand-dialog {
  width: 90vw;
  max-width: 800px;
  max-height: 85vh;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.expand-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.expand-body {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text);
}

.expand-body :deep(table) {
  max-height: 400px;
}

/* ---- Connection Status ---- */
.ds-connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin-bottom: 8px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--bg-hover);
  transition: all 0.3s ease;
}

.ds-connection-status .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ds-connection-status.connected {
  background: rgba(34, 197, 94, 0.1);
}

.ds-connection-status.connected .status-dot {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
}

.ds-connection-status.connected .status-text {
  color: #22c55e;
}

.ds-connection-status.checking {
  background: rgba(234, 179, 8, 0.1);
}

.ds-connection-status.checking .status-dot {
  background: #eab308;
  animation: pulse 1.5s infinite;
}

.ds-connection-status.checking .status-text {
  color: #eab308;
}

.ds-connection-status.disconnected,
.ds-connection-status.no-tab,
.ds-connection-status.no-extension {
  background: rgba(239, 68, 68, 0.1);
}

.ds-connection-status.disconnected .status-dot,
.ds-connection-status.no-tab .status-dot,
.ds-connection-status.no-extension .status-dot {
  background: #ef4444;
}

.ds-connection-status.disconnected .status-text,
.ds-connection-status.no-tab .status-text,
.ds-connection-status.no-extension .status-text {
  color: #ef4444;
}

.ds-connection-status.error {
  background: rgba(239, 68, 68, 0.1);
}

.ds-connection-status.error .status-dot {
  background: #ef4444;
  animation: blink 1s infinite;
}

.ds-connection-status.error .status-text {
  color: #ef4444;
}

.status-hint {
  margin-left: 6px;
  font-size: 11px;
  color: #ef4444;
  text-decoration: underline;
  cursor: pointer;
  white-space: nowrap;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.status-hint:hover {
  opacity: 1;
}

@keyframes pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }
}

@keyframes blink {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
}
</style>

<style>
/* ---- 右键菜单 ---- */
.ctx-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.ctx-menu {
  position: fixed;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  padding: 4px 0;
  min-width: 140px;
  z-index: 10000;
  animation: ctx-fade-in 0.1s ease;
}

@keyframes ctx-fade-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

.ctx-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text, #1f2937);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  user-select: none;
}

.ctx-menu-item:hover {
  background: var(--primary, #3b82f6);
  color: #fff;
}

.ctx-menu-item:hover svg {
  stroke: #fff;
}

.ctx-menu-danger:hover {
  background: #ef4444;
  color: #fff;
}

.ctx-menu-import:hover {
  background: #16a34a;
  color: #fff;
}

/* Toast 提示 */
.toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 10001;
  pointer-events: none;
  white-space: nowrap;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.25s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
}

.rendered-md {
  line-height: 1.7;
  font-size: 13px;
  color: #1f2937;
  overflow-wrap: break-word;
  word-break: break-word;
}

.rendered-md h1,
.rendered-md h2,
.rendered-md h3,
.rendered-md h4,
.rendered-md h5,
.rendered-md h6 {
  margin: 0.8em 0 0.4em;
  font-weight: 700;
  line-height: 1.3;
}

.rendered-md h1 {
  font-size: 1.5em;
}

.rendered-md h2 {
  font-size: 1.25em;
}

.rendered-md h3 {
  font-size: 1.1em;
}

.rendered-md p {
  margin: 0 0 8px;
}

.rendered-md ul,
.rendered-md ol {
  padding-left: 1.5em;
  margin: 0.4em 0;
}

.rendered-md li {
  word-break: break-word;
}

.rendered-md blockquote {
  margin: 0.6em 0;
  padding: 6px 14px;
  border-left: 4px solid #d1d5db;
  color: #6b7280;
  background: #f9fafb;
  border-radius: 0 8px 8px 0;
}

.rendered-md pre {
  background: #1f2937;
  color: #e5e7eb;
  padding: 14px;
  border-radius: 8px;
  margin: 0.6em 0;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
}

.rendered-md code {
  background: #f3f4f6;
  color: #b45353;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.rendered-md pre code {
  color: inherit;
  background: none;
  padding: 0;
}

.rendered-md table {
  border-collapse: collapse;
  margin: 0.8em 0;
  width: 100%;
  display: block;
  overflow-x: auto;
}

.rendered-md th,
.rendered-md td {
  border: 1px solid #e5e5e5;
  padding: 6px 10px;
  text-align: left;
  white-space: nowrap;
  min-width: 60px;
}

.rendered-md th {
  background: #f5f5f5;
  font-weight: 600;
}

.rendered-md tr:nth-child(even) {
  background: #fafafa;
}

.rendered-md hr {
  border: none;
  border-top: 1px solid #e5e5e5;
  margin: 1em 0;
}

.rendered-md a {
  color: #171717;
  text-decoration: none;
}

.rendered-md a:hover {
  text-decoration: underline;
}

.rendered-md strong {
  font-weight: 600;
}
</style>
