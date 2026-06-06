<template>
    <div class="ai-assistant">
        <!-- 悬浮按钮 -->
        <div class="float-btn" :style="btnStyle" @mousedown="startDrag" @click="!isDragging && toggleDrawer()">
            <el-icon :size="24">
                <ChatDotRound />
            </el-icon>
        </div>

        <!-- 抽屉面板 -->
        <el-drawer v-model="visible" direction="rtl" :size="drawerSize + 'px'" :with-header="false"
            :close-on-click-modal="true">
            <!-- 拖拽调整宽度手柄（外边缘） -->
            <div class="drawer-resize-handle" @mousedown.stop="startDrawerResize"></div>

            <div class="assistant-container" ref="containerRef">
                <!-- 区域一：头部 -->
                <div class="split-section split-header" :style="{ height: headerHeight + 'px' }">
                    <div class="assistant-header">
                        <div class="header-left">
                            <el-icon :size="20">
                                <ChatDotRound />
                            </el-icon>
                            <span>OpenStudy 助手</span>
                        </div>
                        <div class="header-right">
                            <AiModelSelector v-if="activeTab === 'chat'" v-model="selectedProvider" width="150px" />
                            <el-icon class="clear-icon" @click="clearMessages" title="清空对话" v-if="activeTab === 'chat'">
                                <Delete />
                            </el-icon>
                            <el-icon class="close-icon" @click="visible = false">
                                <Close />
                            </el-icon>
                        </div>
                    </div>
                    <div class="assistant-tabs">
                        <div :class="['tab-item', { active: activeTab === 'chat' }]" @click="activeTab = 'chat'">
                            <el-icon>
                                <ChatDotRound />
                            </el-icon>
                            <span>对话</span>
                        </div>
                        <div :class="['tab-item', { active: activeTab === 'banks' }]"
                            @click="activeTab = 'banks'; loadMyBanks()">
                            <el-icon>
                                <FolderOpened />
                            </el-icon>
                            <span>我的题库</span>
                        </div>
                        <div :class="['tab-item', { active: activeTab === 'message' }]"
                            @click="activeTab = 'message'; loadMessageBoard()">
                            <el-icon>
                                <ChatLineSquare />
                            </el-icon>
                            <span>留言板</span>
                        </div>
                    </div>
                </div>

                <!-- 区域二：内容区（flex:1 自动填满剩余空间） -->
                <div class="split-section split-content">
                    <!-- 题库面板 -->
                    <div v-if="activeTab === 'banks'" class="banks-panel">
                        <div class="bank-search">
                            <el-input v-model="bankKeyword" placeholder="搜索题库名称或科目" prefix-icon="Search" clearable
                                size="small" />
                        </div>
                        <div class="bank-list" v-loading="bankLoading">
                            <div v-for="bank in filteredBanks" :key="bank.id" class="bank-item"
                                @click="jumpToBank(bank.id)">
                                <div class="bank-info">
                                    <div class="bank-name">{{ bank.bankName }}</div>
                                    <div class="bank-meta">
                                        <span class="bank-subject">{{ bank.subject || '未分类' }}</span>
                                        <span class="bank-count">{{ bank.totalQuestions || 0 }} 题</span>
                                    </div>
                                </div>
                                <el-icon class="bank-arrow">
                                    <ArrowRight />
                                </el-icon>
                            </div>
                            <el-empty v-if="!bankLoading && filteredBanks.length === 0" description="暂无题库"
                                :image-size="60" />
                        </div>
                    </div>

                    <!-- 留言板面板 -->
                    <div v-else-if="activeTab === 'message'" class="message-board-panel">
                        <div class="msg-search-section">
                            <el-input v-model="msgSearchKeyword" placeholder="搜索留言..." clearable size="small"
                                @input="handleMsgSearch">
                                <template #prefix>
                                    <el-icon>
                                        <Search />
                                    </el-icon>
                                </template>
                            </el-input>
                        </div>
                        <div class="message-list" v-loading="messageLoading">
                            <div v-for="msg in filteredMessages" :key="msg.id" class="message-item">
                                <div class="message-avatar-wrap">
                                    <div class="message-avatar">
                                        <el-icon>
                                            <User />
                                        </el-icon>
                                    </div>
                                </div>
                                <div class="message-body">
                                    <div class="message-meta">
                                        <span class="message-user">{{ msg.userName }}</span>
                                        <span class="message-time">{{ formatTime(msg.createTime) }}</span>
                                    </div>
                                    <div class="message-content">{{ msg.content }}</div>
                                </div>
                            </div>
                            <el-empty v-if="!messageLoading && filteredMessages.length === 0"
                                :description="msgSearchKeyword ? '未找到匹配的留言' : '暂无留言'" :image-size="60" />
                        </div>
                        <div class="message-input">
                            <el-input v-model="messageContent" type="textarea" placeholder="写下你的留言..." :rows="2"
                                resize="none" />
                            <el-button class="submit-btn" size="small" :loading="messageSubmitting"
                                @click="submitMessage">发布</el-button>
                        </div>
                    </div>

                    <!-- 聊天面板 -->
                    <AiChatStream v-else v-model:messages="messages" :is-generating="isGenerating"
                        placeholder="输入消息..." @send="handleChatSend" @stop="stopGeneration">
                        <template #empty>
                            <div class="welcome-card">
                                <div class="welcome-icon">🤖</div>
                                <div class="welcome-title">你好，我是 OpenStudy 助手</div>
                                <div class="welcome-desc">开源、低成本、低门槛的 AI 学习平台</div>
                                <div class="quick-actions">
                                    <div class="quick-item" @click="sendQuickMessage('介绍一下 OpenStudy 平台')">
                                        <el-icon>
                                            <InfoFilled />
                                        </el-icon>
                                        <span>介绍平台</span>
                                    </div>
                                    <div class="quick-item" @click="activeTab = 'banks'; loadMyBanks()">
                                        <el-icon>
                                            <FolderOpened />
                                        </el-icon>
                                        <span>我的题库</span>
                                    </div>
                                    <div class="quick-item" @click="sendQuickMessage('如何创建题库？')">
                                        <el-icon>
                                            <QuestionFilled />
                                        </el-icon>
                                        <span>创建题库</span>
                                    </div>
                                    <div class="quick-item" @click="sendQuickMessage('怎么刷题？')">
                                        <el-icon>
                                            <EditPen />
                                        </el-icon>
                                        <span>刷题指南</span>
                                    </div>
                                    <div class="quick-item" @click="goToNotesEditor">
                                        <el-icon>
                                            <EditPen />
                                        </el-icon>
                                        <span>写笔记</span>
                                    </div>
                                    <div class="quick-item" @click="goToNotesList">
                                        <el-icon>
                                            <Notebook />
                                        </el-icon>
                                        <span>笔记分享</span>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </AiChatStream>
                </div>

                <!-- 拖拽条：内容区 ↔ 输入区 -->
            </div>
        </el-drawer>
    </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { assistantStream } from '@/api/ai/ai'
import { listMyQuestionBank } from '@/api/questionBank/questionBank'
import { getLeaveMessageList, addLeaveMessage } from '@/api/leaveMessage'
import { useRouter } from 'vue-router'
import useUserStore from '@/store/modules/user'
import {
    ChatDotRound, Close, User, FolderOpened,
    Search, ArrowRight, InfoFilled, QuestionFilled, EditPen, Delete, Notebook, ChatLineSquare
} from '@element-plus/icons-vue'

import { useStreamGeneration } from '@/composables/useStreamGeneration'
import AiChatStream from '@/components/AiChatStream/index.vue'
import AiModelSelector from '@/components/AiModelSelector/index.vue'

import { getConversationHistory, clearConversation } from '@/api/ai/ai'

const SESSION_ID = 'assistant'

const router = useRouter()
const userStore = useUserStore()
const activeTab = ref('chat')
const selectedProvider = ref('')
const myBanks = ref([])
const bankLoading = ref(false)
const bankKeyword = ref('')

// 留言板
const messageBoardList = ref([])
const messageLoading = ref(false)
const messageContent = ref('')
const messageSubmitting = ref(false)
const msgSearchKeyword = ref('')
let msgSearchTimer = null

const goToNotesEditor = () => {
    visible.value = false
    router.push('/front/notes/editor')
}

const goToNotesList = () => {
    visible.value = false
    router.push('/front/notes/list')
}

// ========== 悬浮按钮拖拽 ==========
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const btnPos = ref({ x: 0, y: 0 })
const btnStyle = ref({})

// ========== 抽屉宽度拖拽 ==========
const DRAWER_SIZE_KEY = 'openstudy_drawer_size'
const drawerSize = ref(Number(localStorage.getItem(DRAWER_SIZE_KEY)) || 420)
let isResizingDrawer = false
let resizeStartX = 0
let resizeStartSize = 0
let resizeRaf = 0

const startDrawerResize = (e) => {
    e.preventDefault()
    isResizingDrawer = true
    resizeStartX = e.clientX
    resizeStartSize = drawerSize.value
    const drawer = document.querySelector('.ai-assistant .el-drawer')
    if (drawer) drawer.style.transition = 'none'
    document.addEventListener('mousemove', onDrawerResize, { passive: false })
    document.addEventListener('mouseup', stopDrawerResize)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.style.pointerEvents = 'none'
    e.target.style.pointerEvents = 'auto'
}

const onDrawerResize = (e) => {
    if (!isResizingDrawer) return
    e.preventDefault()
    cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(() => {
        const delta = resizeStartX - e.clientX
        drawerSize.value = Math.max(320, Math.min(800, resizeStartSize + delta))
    })
}

const stopDrawerResize = () => {
    isResizingDrawer = false
    cancelAnimationFrame(resizeRaf)
    document.removeEventListener('mousemove', onDrawerResize)
    document.removeEventListener('mouseup', stopDrawerResize)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.body.style.pointerEvents = ''
    const drawer = document.querySelector('.ai-assistant .el-drawer')
    if (drawer) drawer.style.transition = ''
    localStorage.setItem(DRAWER_SIZE_KEY, String(drawerSize.value))
}

// ========== 三段式垂直分割 ==========
const containerRef = ref(null)
const headerHeight = ref(100)

// ========== 状态 ==========
const visible = ref(false)
const messages = reactive([])
let aiMsgIndex = 0

const stopGeneration = () => { stream.abort() }

const initPosition = () => {
    btnPos.value = { x: window.innerWidth - 100, y: window.innerHeight - 150 }
}

const startDrag = (e) => {
    isDragging.value = true
    dragStart.value = { x: e.clientX - btnPos.value.x, y: e.clientY - btnPos.value.y }
}

const onDrag = (e) => {
    if (!isDragging.value) return
    e.preventDefault()
    const btnSize = 52
    let newX = Math.max(10, Math.min(window.innerWidth - btnSize - 10, e.clientX - dragStart.value.x))
    let newY = Math.max(10, Math.min(window.innerHeight - btnSize - 10, e.clientY - dragStart.value.y))
    btnPos.value = { x: newX, y: newY }
    btnStyle.value = { left: newX + 'px', top: newY + 'px', right: 'auto', bottom: 'auto' }
}

const stopDrag = () => {
    if (isDragging.value) {
        const btnSize = 52
        const centerX = btnPos.value.x + btnSize / 2
        btnPos.value.x = centerX < window.innerWidth / 2 ? 20 : window.innerWidth - btnSize - 20
        btnStyle.value = {
            left: btnPos.value.x + 'px', top: btnPos.value.y + 'px',
            right: 'auto', bottom: 'auto', transition: 'left 0.3s ease'
        }
    }
    isDragging.value = false
}

// ========== 业务逻辑 ==========
const loadMyBanks = async () => {
    bankLoading.value = true
    try {
        const res = await listMyQuestionBank()
        if (res.code === 200) myBanks.value = res.data || []
    } finally { bankLoading.value = false }
}

const jumpToBank = (bankId) => {
    router.push(`/front/studio/create?bankId=${bankId}`)
    visible.value = false
}

const loadMessageBoard = async () => {
    messageLoading.value = true
    try {
        const res = await getLeaveMessageList()
        if (res.code === 200) messageBoardList.value = res.data || []
    } finally { messageLoading.value = false }
}

const submitMessage = async () => {
    if (!messageContent.value.trim() || messageSubmitting.value) return
    messageSubmitting.value = true
    try {
        const res = await addLeaveMessage({ content: messageContent.value.trim() })
        if (res.code === 200) { messageContent.value = ''; await loadMessageBoard() }
    } finally { messageSubmitting.value = false }
}

const formatTime = (time) => {
    if (!time) return ''
    const d = new Date(time)
    return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const filteredBanks = computed(() => {
    if (!bankKeyword.value) return myBanks.value
    const kw = bankKeyword.value.toLowerCase()
    return myBanks.value.filter(b => b.bankName?.toLowerCase().includes(kw) || b.subject?.toLowerCase().includes(kw))
})

const filteredMessages = computed(() => {
    if (!msgSearchKeyword.value) return messageBoardList.value
    const kw = msgSearchKeyword.value.toLowerCase()
    return messageBoardList.value.filter(m => m.content?.toLowerCase().includes(kw) || m.userName?.toLowerCase().includes(kw))
})

const handleMsgSearch = () => {
    if (msgSearchTimer) clearTimeout(msgSearchTimer)
    msgSearchTimer = setTimeout(() => { }, 300)
}

const toggleDrawer = () => { visible.value = !visible.value }

// ========== 流式生成 ==========
const stream = useStreamGeneration({
    onChunk: (fullContent) => { messages[aiMsgIndex].content = fullContent },
    onComplete: () => { },
    onError: (error) => {
        console.error('发送失败:', error)
        messages[aiMsgIndex].content = '抱歉，发送失败，请重试。'
    }
})

const isGenerating = computed(() => stream.isGenerating.value)

const handleChatSend = ({ content }) => {
    if (!content || stream.isGenerating.value) return
    messages.push({ role: 'user', content })
    aiMsgIndex = messages.length
    messages.push({ role: 'assistant', content: '' })
    stream.start((handleChunk, handleComplete, handleError, signal) => {
        assistantStream(content, handleChunk, handleComplete, handleError, signal, selectedProvider.value, userStore.id)
    })
}

const sendQuickMessage = (msg) => {
    activeTab.value = 'chat'
    handleChatSend({ content: msg })
}

const clearMessages = async () => {
    try { await clearConversation(SESSION_ID, userStore.id); messages.length = 0 }
    catch (e) { console.error('清空失败:', e) }
}

const loadHistory = async () => {
    try {
        const res = await getConversationHistory(SESSION_ID, userStore.id)
        if (res.code === 200 && res.data) messages.push(...res.data)
    } catch (e) { console.error('加载历史失败:', e) }
}

// ========== 生命周期 ==========
onMounted(() => {
    initPosition()
    loadHistory()
    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', stopDrag)
})

onUnmounted(() => {
    window.removeEventListener('mousemove', onDrag)
    window.removeEventListener('mouseup', stopDrag)
})
</script>

<style scoped lang="scss">
.ai-assistant {
    :deep(.el-drawer) {
        overflow: visible;
    }

    :deep(.el-drawer__body) {
        overflow: hidden;
        position: relative;
    }
}

.ai-assistant {
    .float-btn {
        position: fixed;
        left: auto;
        right: 24px;
        bottom: 80px;
        width: 52px;
        height: 52px;
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(0, 0, 0, 0.06);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #4b5563;
        cursor: grab;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
        transition: box-shadow 0.2s ease;
        z-index: 1000;
        user-select: none;

        &:active {
            cursor: grabbing;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        }

        &:hover {
            background: #ffffff;
            color: #1a1a1a;
        }
    }
}

// ========== 抽屉宽度拖拽手柄 ==========
.drawer-resize-handle {
    position: absolute;
    left: -4px;
    top: 0;
    bottom: 0;
    width: 12px;
    cursor: col-resize;
    z-index: 10;

    &::after {
        content: '';
        position: absolute;
        left: 5px;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 32px;
        border-radius: 2px;
        background: transparent;
        transition: background 0.15s;
    }

    &:hover::after,
    &:active::after {
        background: #c0c4cc;
    }
}

// ========== 三段式容器 ==========
.assistant-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.split-header {
    flex-shrink: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.split-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

// ========== 头部区域 ==========
.split-header {
    .assistant-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid #e4e7ed;

        .header-left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 16px;
            font-weight: 600;
            color: #303133;
        }

        .close-icon {
            cursor: pointer;
            color: #909399;

            &:hover {
                color: #303133;
            }
        }
    }

    .assistant-tabs {
        display: flex;
        padding: 8px 16px;
        border-bottom: 1px solid #e4e7ed;
        gap: 24px;

        .tab-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 0;
            font-size: 14px;
            color: #909399;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;

            &:hover {
                color: #303133;
            }

            &.active {
                color: #1a6eff;
                border-bottom-color: #1a6eff;
            }
        }
    }

}

// ========== 题库面板 ==========
.banks-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    .bank-search {
        padding: 12px 16px;

        :deep(.el-input__wrapper) {
            border-radius: 8px;
        }
    }

    .bank-list {
        flex: 1;
        overflow-y: auto;
        padding: 0 16px 16px;

        .bank-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 12px;
            margin-bottom: 8px;
            background: #f8f9fa;
            border-radius: 16px;
            cursor: pointer;
            transition: all 0.2s;

            &:hover {
                background: #e8f0fe;
            }

            .bank-info {
                flex: 1;

                .bank-name {
                    font-size: 14px;
                    font-weight: 500;
                    color: #303133;
                    margin-bottom: 6px;
                }

                .bank-meta {
                    display: flex;
                    gap: 16px;
                    font-size: 12px;
                    color: #909399;
                }
            }

            .bank-arrow {
                color: #c0c4cc;
                font-size: 14px;
            }
        }
    }
}

// ========== 留言板面板 ==========
.message-board-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    .msg-search-section {
        padding: 12px 16px 8px;

        :deep(.el-input__wrapper) {
            border-radius: 8px;
            box-shadow: 0 0 0 1px #e5e7eb;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            background: #f8f9fa;

            &:hover {
                box-shadow: 0 0 0 1px #d1d5db;
            }

            &.is-focus {
                box-shadow: 0 0 0 1px #b3b3b3;
                background: #fff;
            }
        }
    }

    .message-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px 16px 12px;

        .message-item {
            display: flex;
            gap: 10px;
            padding: 12px;
            margin-bottom: 10px;
            background: #fff;
            border-radius: 12px;
            border: 1px solid #e5e7eb;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

            &:hover {
                border-color: #d1d5db;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
            }

            .message-avatar-wrap {
                flex-shrink: 0;

                .message-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #f3f4f6;
                    color: #6b7280;
                }
            }

            .message-body {
                flex: 1;
                min-width: 0;

                .message-meta {
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                    margin-bottom: 6px;

                    .message-user {
                        font-size: 13px;
                        font-weight: 600;
                        color: #1f2937;
                    }

                    .message-time {
                        font-size: 11px;
                        color: #9ca3af;
                    }
                }

                .message-content {
                    font-size: 13px;
                    color: #6b7280;
                    line-height: 1.6;
                    word-break: break-word;
                }
            }
        }
    }

    .message-input {
        padding: 12px 16px 16px;
        border-top: 1px solid #f3f4f6;
        display: flex;
        gap: 10px;
        align-items: flex-end;
        background: #fff;

        .el-textarea {
            flex: 1;

            :deep(.el-textarea__inner) {
                border-radius: 8px;
                border-color: #e5e7eb;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                font-size: 13px;

                &:hover {
                    border-color: #d1d5db;
                }

                &:focus {
                    border-color: #b3b3b3;
                    box-shadow: none;
                }
            }
        }

        .submit-btn {
            flex-shrink: 0;
            height: 32px;
            border-radius: 8px;
            font-weight: 500;
            font-size: 13px;
            padding: 0 14px;
            background: #fff;
            border: 1px solid #e5e7eb;
            color: #6b7280;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

            &:hover {
                transform: translateY(-2px);
                border-color: #d1d5db;
                color: #4b5563;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
            }

            &:active {
                transform: translateY(0);
            }
        }
    }
}

// ========== 欢迎卡片 ==========
.welcome-card {
    text-align: center;
    padding: 20px 16px;

    .welcome-icon {
        font-size: 48px;
        margin-bottom: 16px;
    }

    .welcome-title {
        font-size: 18px;
        font-weight: 600;
        color: #303133;
        margin-bottom: 8px;
    }

    .welcome-desc {
        font-size: 14px;
        color: #909399;
        margin-bottom: 24px;
    }

    .quick-actions {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;

        .quick-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            padding: 14px 8px;
            background: #f8f9fa;
            border-radius: 16px;
            cursor: pointer;
            transition: all 0.2s;

            &:hover {
                background: #e8f0fe;
            }

            .el-icon {
                font-size: 22px;
                color: #1a6eff;
            }

            span {
                font-size: 12px;
                color: #606266;
            }
        }
    }
}

// ========== 头部右侧图标 ==========
.header-right {
    display: flex;
    align-items: center;
    gap: 12px;

    .clear-icon {
        cursor: pointer;
        color: #909399;

        &:hover {
            color: #f56c6c;
        }
    }

    .close-icon {
        cursor: pointer;
        color: #909399;

        &:hover {
            color: #303133;
        }
    }
}

@keyframes typing {

    0%,
    60%,
    100% {
        transform: translateY(0);
        opacity: 0.5;
    }

    30% {
        transform: translateY(-8px);
        opacity: 1;
    }
}
</style>
