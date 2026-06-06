<template>
    <el-dialog v-model="visible" title="🤖 AI 题目解析" width="600px" :close-on-click-modal="false" @close="handleClose">
        <div class="model-select-bar">
            <span class="model-label">模型：</span>
            <AiModelSelector v-model="selectedProvider" width="180px" />
        </div>
        <div class="analysis-container">
            <!-- 题目信息 -->
            <div class="question-info">
                <div class="question-text">{{ getPlainText(question) }}</div>
                <div class="question-meta">
                    <el-tag v-if="questionType" size="small">{{ questionType }}</el-tag>
                </div>
            </div>

            <!-- 流式输出内容 -->
            <div class="analysis-content" ref="contentRef">
                <div v-if="streamContent" v-html="formattedContent"></div>
                <div v-else-if="isGeneratingState" class="loading-tip">
                    <el-icon class="is-loading">
                        <Loading />
                    </el-icon>
                    <span>AI 正在解析中...</span>
                </div>
                <div v-else class="empty-tip">
                    点击「开始解析」获取 AI 解析结果
                </div>
            </div>
        </div>

        <template #footer>
            <div class="dialog-footer">
                <el-button @click="copyContent" v-if="streamContent">
                    <el-icon>
                        <DocumentCopy />
                    </el-icon>
                    复制解析
                </el-button>
                <el-button @click="handleClose">关闭</el-button>
                <el-button type="primary" @click="startAnalysis" :loading="isGeneratingState">
                    {{ isGeneratingState ? '解析中...' : '开始解析' }}
                </el-button>
            </div>
        </template>
    </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Loading, DocumentCopy } from '@element-plus/icons-vue'
import { analyzeQuestionStream } from '@/api/ai/ai'
import { ElMessage } from 'element-plus'
import AiModelSelector from '@/components/AiModelSelector/index.vue'
import useUserStore from '@/store/modules/user'
import { getPlainText } from '@/utils/questionUtils'

const userStore = useUserStore()

const props = defineProps({
    question: { type: String, default: '' },
    questionId: { type: [Number, String], default: null },  // 新增
    questionType: { type: String, default: '' },
    options: { type: String, default: '' },
    correctAnswer: { type: [String, Array], default: '' },
    cachedContent: { type: String, default: '' },  // 新增：缓存内容
    isGenerating: { type: Boolean, default: false }  // 新增：外部生成状态
})

const emit = defineEmits(['close', 'update-cache', 'generating'])

const visible = ref(true)
const streamContent = ref(props.cachedContent || '')
const selectedProvider = ref('')

const isGenerating = ref(false)
const contentRef = ref(null)

// 监听缓存变化
watch(() => props.cachedContent, (newVal) => {
    if (!isGenerating.value) {
        streamContent.value = newVal || ''
    }
})

// 监听外部 isGenerating 状态变化（用于父组件控制）
watch(() => props.isGenerating, (newVal) => {
    if (newVal !== undefined) {
        isGenerating.value = newVal
    }
})

// 计算属性：综合判断是否正在生成（优先使用外部 prop，内部状态作为后备）
const isGeneratingState = computed(() => {
    return props.isGenerating !== false ? props.isGenerating : isGenerating.value
})

// 格式化内容（简单处理换行和标题）
// 格式化内容
const formattedContent = computed(() => {
    let content = streamContent.value

    // 处理分隔线
    content = content.replace(/━+/g, '<hr class="divider">')

    // 处理标题
    content = content.replace(/^([🧠🎯📌📊]\s*[^\\n]+)/gm, '<h4 class="section-title">$1</h4>')

    // 处理步骤数字
    content = content.replace(/(\d+)\./g, '<span class="step-number">$1.</span>')

    // 处理标签
    content = content.replace(/#(\S+)/g, '<span class="tag">#$1</span>')

    // 处理星星
    content = content.replace(/⭐/g, '<span class="star">⭐</span>')

    // 处理换行
    content = content.replace(/\n/g, '<br>')

    return content
})

// 复制解析内容
const copyContent = async () => {
    try {
        // 获取纯文本内容（去除 HTML 标签）
        const plainText = streamContent.value
            .replace(/<[^>]+>/g, '')  // 去除 HTML 标签
            .replace(/&nbsp;/g, ' ')   // 替换 &nbsp;
            .replace(/&lt;/g, '<')     // 替换 &lt;
            .replace(/&gt;/g, '>')     // 替换 &gt;
            .replace(/&amp;/g, '&')    // 替换 &amp;
            .trim()

        await navigator.clipboard.writeText(plainText)
        ElMessage.success('解析内容已复制到剪贴板')
    } catch (error) {
        console.error('复制失败:', error)
        ElMessage.error('复制失败，请手动复制')
    }
}

// 开始解析
const startAnalysis = async () => {
    // 如果已有缓存，直接显示
    if (props.cachedContent) {
        streamContent.value = props.cachedContent
        return
    }

    emit('generating', true)
    streamContent.value = ''

    // ✅ 添加：格式化选项
    let optionsStr = ''
    if (props.options) {
        try {
            const opts = typeof props.options === 'string' ? JSON.parse(props.options) : props.options
            if (Array.isArray(opts)) {
                optionsStr = opts.map((opt, idx) =>
                    `${String.fromCharCode(65 + idx)}. ${opt}`
                ).join('\n')
            }
        } catch (e) {
            optionsStr = props.options
        }
    }

    // ✅ 添加：格式化答案
    let answerStr = ''
    if (Array.isArray(props.correctAnswer)) {
        answerStr = props.correctAnswer.map(a =>
            typeof a === 'number' ? String.fromCharCode(65 + a) : a
        ).join(', ')
    } else if (typeof props.correctAnswer === 'number') {
        answerStr = String.fromCharCode(65 + props.correctAnswer)
    } else {
        answerStr = String(props.correctAnswer || '')
    }

    // 调用流式 API
    analyzeQuestionStream(
        props.question,
        props.questionType,
        optionsStr,
        answerStr,
        (content) => {
            streamContent.value = content
            emit('update-cache', content)
            setTimeout(() => {
                if (contentRef.value) {
                    contentRef.value.scrollTop = contentRef.value.scrollHeight
                }
            }, 50)
        },
        () => {
            emit('generating', false)
        },
        (error) => {
            console.error('解析失败:', error)
            ElMessage.error('解析失败，请重试')
            emit('generating', false)
        },
        selectedProvider.value,
        userStore.id
    )
}

const handleClose = () => {
    visible.value = false
    emit('close')
}
</script>

<style scoped lang="scss">
.model-select-bar {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
    gap: 8px;

    .model-label {
        font-size: 13px;
        color: #6b7280;
        flex-shrink: 0;
    }
}

.analysis-container {
    .question-info {
        background: #f5f7fa;
        padding: 16px;
        border-radius: 12px;
        margin-bottom: 16px;

        .question-text {
            font-size: 15px;
            line-height: 1.6;
            color: #303133;
            margin-bottom: 8px;
        }
    }

    .analysis-content {
        min-height: 200px;
        max-height: 400px;
        overflow-y: auto;
        padding: 20px;
        background: #fafbfc;
        border-radius: 12px;
        border: 1px solid #e4e7ed;
        line-height: 1.8;

        :deep(.section-title) {
            margin: 20px 0 12px 0;
            color: #303133;
            font-size: 16px;
            font-weight: 600;

            &:first-child {
                margin-top: 0;
            }
        }

        :deep(.divider) {
            margin: 16px 0;
            border: none;
            border-top: 1px solid #e4e7ed;
        }

        :deep(.step-number) {
            display: inline-block;
            font-weight: 600;
            color: #409eff;
            margin-right: 6px;
        }

        :deep(.tag) {
            display: inline-block;
            background: #ecf5ff;
            color: #409eff;
            padding: 2px 10px;
            border-radius: 4px;
            font-size: 13px;
            margin: 0 6px 6px 0;
        }

        :deep(.star) {
            color: #e6a23c;
            font-size: 16px;
        }
    }
}

.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;

    :deep(.el-button) {
        border-radius: 8px;
    }
}
</style>