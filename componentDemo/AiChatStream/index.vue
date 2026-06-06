<template>
  <div class="ai-chat-stream">
    <!-- 消息列表 -->
    <div class="chat-messages" ref="messagesRef">
      <!-- 空状态插槽 -->
      <slot name="empty" v-if="messages.length === 0 && !isGenerating"></slot>

      <div v-for="(msg, idx) in messages" :key="idx" :class="['message', msg.role]">
        <div class="message-content" v-if="msg.role === 'assistant'">
          <div class="message-role">AI</div>
          <div class="message-text rendered-md" @click="copyText(msg.content)" v-html="renderMarkdown(msg.content)">
          </div>
          <el-button class="msg-copy-btn" size="small" text @click.stop="copyText(msg.content)"
            v-if="msg.content && msg.content.trim()">
            复制
          </el-button>
          <div v-if="!msg.content && isGenerating" class="ai-loading-inline">
            <span class="ai-loading-text">AI 思考中</span>
            <LoadingDots size="small" />
          </div>
        </div>
        <div class="message-content" v-else>
          <div class="message-role">我</div>
          <div class="message-text">{{ msg.content }}</div>
        </div>
      </div>

      <!-- 滚动按钮（sticky 固定在可视区域右下角） -->
      <div class="chat-scroll-sticky">
        <button class="scroll-btn-mini" @click="scrollToBottom" title="滚动到底部">
          <el-icon size="16">
            <ArrowDown />
          </el-icon>
        </button>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="chat-input-area">
      <div class="input-wrapper">
        <el-input v-model="inputContent" type="textarea" :rows="2" :placeholder="placeholder"
          @keydown.ctrl.enter="handleSend" :disabled="isGenerating" class="chat-textarea" />
        <div class="input-actions">
          <slot name="input-left"></slot>
          <div class="action-buttons">
            <el-button v-if="isGenerating" @click="$emit('stop')" class="btn-stop" size="small">
              停止
            </el-button>
            <el-button class="btn-send" @click="handleSend" :loading="isGenerating"
              :disabled="isGenerating || !inputContent.trim()">
              发送
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import LoadingDots from '@/components/LoadingDots/index.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  isGenerating: { type: Boolean, default: false },
  placeholder: { type: String, default: '输入消息...（Ctrl+Enter 发送）' }
})

const emit = defineEmits(['update:messages', 'send', 'stop'])

const inputContent = ref('')
const messagesRef = ref(null)
const isNearBottom = ref(true)

const renderMarkdown = (content) => {
  if (!content) return ''
  const html = marked.parse(content)
  return DOMPurify.sanitize(html)
}

const copyText = async (text) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('复制成功')
  } catch {
    ElMessage.error('复制失败')
  }
}

const handleSend = () => {
  const content = inputContent.value.trim()
  if (!content || props.isGenerating) return
  emit('send', { content })
  inputContent.value = ''
}

// 检测是否在底部附近（50px 内）
const checkNearBottom = () => {
  if (!messagesRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = messagesRef.value
  isNearBottom.value = scrollHeight - scrollTop - clientHeight < 50
}

const scrollToBottom = async () => {
  await nextTick()
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

// 只在用户在底部附近时自动滚动
const autoScrollIfNearBottom = async () => {
  if (!isNearBottom.value) return
  await nextTick()
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

onMounted(() => {
  if (messagesRef.value) {
    messagesRef.value.addEventListener('scroll', checkNearBottom, { passive: true })
  }
})

onUnmounted(() => {
  if (messagesRef.value) {
    messagesRef.value.removeEventListener('scroll', checkNearBottom)
  }
})

// 新消息到来时：如果在底部附近则滚动
watch(() => props.messages.length, () => {
  autoScrollIfNearBottom()
})

// 流式内容更新时：如果在底部附近则滚动
watch(() => {
  if (props.messages.length > 0) {
    const last = props.messages[props.messages.length - 1]
    return last?.content?.length || 0
  }
  return 0
}, () => {
  if (props.isGenerating) {
    autoScrollIfNearBottom()
  }
})

defineExpose({ scrollToBottom, messagesRef })
</script>

<style scoped lang="scss">
.ai-chat-stream {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background-color: #f8f9fa;
  border-radius: 12px;
  position: relative;
}

.chat-scroll-sticky {
  position: sticky;
  bottom: 4px;
  float: right;
  margin-top: -36px;
  z-index: 5;
  pointer-events: none;
}

.scroll-btn-mini {
  pointer-events: auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  transition: all 0.2s;

  &:hover {
    background: #f3f4f6;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }
}

.message {
  margin-bottom: 16px;
  display: flex;
}

.message.user {
  justify-content: flex-end;
}

.message.assistant {
  justify-content: flex-start;
}

.message-content {
  max-width: 75%;
  padding: 12px 16px;
  border-radius: 16px;
  background-color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
  border: 1px solid #e5e7eb;
  position: relative;
}

.message.user .message-content {
  background-color: #f3f4f6;
  color: #1f2937;
  border: 1px solid #e5e7eb;
}

.message-role {
  font-size: 12px;
  margin-bottom: 6px;
  opacity: 0.7;
}

.message-text {
  line-height: 1.6;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.msg-copy-btn {
  position: absolute;
  bottom: 8px;
  right: 12px;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  z-index: 10;
  color: #6b7280;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  transition: all 0.2s;
}

.msg-copy-btn:hover {
  background: #fff;
  border-color: #d1d5db;
}

/* AI 加载动画（内联在消息内） */
.ai-loading-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.ai-loading-text {
  color: #909399;
  font-size: 13px;
}

/* 打字动画 */
.typing {
  display: flex;
  gap: 4px;
  align-items: center;
  min-height: 20px;
}

.typing span {
  width: 8px;
  height: 8px;
  background-color: #999;
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out both;
}

.typing span:nth-child(1) {
  animation-delay: -0.32s;
}

.typing span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typing {

  0%,
  80%,
  100% {
    transform: scale(0);
  }

  40% {
    transform: scale(1);
  }
}

/* 输入区 */
.chat-input-area {
  background-color: white;
  border-top: 1px solid #e5e7eb;
  padding: 10px 16px 12px;
}

.input-wrapper {
  width: 100%;
}

.chat-textarea :deep(.el-textarea__inner) {
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e5e7eb;
  font-size: 14px;
  line-height: 1.5;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    box-shadow: 0 0 0 1px #d1d5db;
  }

  &:focus {
    box-shadow: 0 0 0 1px #b3b3b3;
  }
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 8px;
  gap: 8px;
}

.action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.btn-send {
  border-radius: 8px;
  font-weight: 500;
  padding: 6px 14px;
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #6b7280;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    transform: translateY(-2px);
    border-color: #d1d5db;
    color: #4b5563;
  }

  &:active {
    transform: translateY(0);
  }
}

.btn-stop {
  background: #fef2f2;
  border-color: #e5d0d0;
  color: #b45353;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    background: #fff;
    border-color: #b38080;
    color: #9b3a3a;
  }
}
</style>

<style lang="scss">
.rendered-md {
  line-height: 1.7;
  font-size: 15px;
  color: #1f2937;
  padding-bottom: 20px;
  cursor: pointer;
  overflow-wrap: break-word;
  word-break: break-word;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 1em 0 0.5em;
    color: #1f2937;
    font-weight: 700;
    line-height: 1.3;
    word-break: break-word;
  }

  h1 {
    font-size: 1.75em;
  }

  h2 {
    font-size: 1.35em;
  }

  h3 {
    font-size: 1.15em;
  }

  p {
    margin: 0 0 10px;
  }

  ul,
  ol {
    padding-left: 1.5em;
    margin: 0.4em 0;
  }

  li {
    word-break: break-word;
  }

  blockquote {
    margin: 0.6em 0;
    padding: 6px 14px;
    border-left: 4px solid #d1d5db;
    color: #6b7280;
    background: #f9fafb;
    border-radius: 0 8px 8px 0;
  }

  pre {
    background: #1f2937;
    color: #e5e7eb;
    padding: 14px;
    border-radius: 8px;
    margin: 0.6em 0;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.5;
    max-width: 100%;
  }

  code {
    background: #f3f4f6;
    color: #b45353;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
    word-break: break-word;
  }

  pre code {
    color: inherit;
    background: none;
    padding: 0;
    word-break: normal;
  }

  table {
    border-collapse: collapse;
    margin: 0.8em 0;
    width: 100%;
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  th,
  td {
    border: 1px solid #e5e7eb;
    padding: 8px 12px;
    text-align: left;
    white-space: nowrap;
    min-width: 60px;
  }

  th {
    background: #f9fafb;
    font-weight: 600;
  }

  tr:nth-child(even) {
    background: #fafbfc;
  }

  hr {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 1em 0;
  }

  img {
    max-width: 100%;
    border-radius: 8px;
  }

  a {
    color: #409eff;
    text-decoration: none;
    word-break: break-word;
  }

  a:hover {
    text-decoration: underline;
  }
}
</style>
