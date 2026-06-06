<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'
import RichTextEditor from '../components/RichTextEditor.vue'
import AiPanel from '../components/AiPanel.vue'
import ScrollButton from '../components/ScrollButton.vue'

const route = useRoute()
const router = useRouter()
const store = useProjectStore()

const projectId = route.params.projectId
const chapterId = route.params.chapterId

const chapterTitle = ref('')
const editorContent = ref('')
const wordCount = ref(0)
const saving = ref(false)
const showAiPanel = ref(false)
const editorRef = ref(null)
const editorBodyRef = ref(null)

let saveTimer = null

onMounted(async () => {
  await store.fetchProject(projectId)
  const chapter = await store.fetchChapter(projectId, chapterId)
  chapterTitle.value = chapter.title
  editorContent.value = chapter.content
})

function onEditorUpdate({ html, text }) {
  editorContent.value = html
  wordCount.value = countWords(text)
  // Auto-save debounce
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveChapter(), 3000)
}

function countWords(text) {
  const chinese = (text.match(/[一-鿿]/g) || []).length
  const english = (text.match(/[a-zA-Z]+/g) || []).length
  return chinese + english
}

async function saveChapter() {
  saving.value = true
  try {
    await store.updateChapter(projectId, chapterId, {
      title: chapterTitle.value,
      content: editorContent.value
    })
  } finally {
    saving.value = false
  }
}

function onAiInsert(text) {
  if (editorRef.value) {
    editorRef.value.insertContent(text)
  }
}

function onAiImport(text) {
  if (editorRef.value) {
    editorRef.value.replaceSelection(text)
  }
}

async function openFreeMode() {
  await saveChapter()
  const url = `https://chat.deepseek.com/?nf_project=${projectId}&nf_chapter=${chapterId}&nf_title=${encodeURIComponent(chapterTitle.value)}`
  window.open(url, '_blank')
}
</script>

<template>
  <div class="editor-page">
    <!-- Top Bar -->
    <div class="editor-topbar">
      <button class="btn-back" @click="router.push(`/project/${projectId}`)">&larr; {{ store.currentProject?.title
        }}</button>
      <input v-model="chapterTitle" class="title-input" placeholder="章节标题" @blur="saveChapter" />
      <div class="topbar-right">
        <span class="word-count">{{ wordCount }} 字</span>
        <span v-if="saving" class="saving">保存中...</span>
        <span v-else class="saved">已保存</span>
        <button class="btn-free" @click="openFreeMode">免费模式</button>
        <button class="btn-ai" :class="{ active: showAiPanel }" @click="showAiPanel = !showAiPanel">AI 助手</button>
      </div>
    </div>

    <!-- Editor -->
    <div class="editor-body" ref="editorBodyRef">
      <div class="editor-main">
        <RichTextEditor ref="editorRef" :content="editorContent" @update="onEditorUpdate" />
      </div>
    </div>

    <ScrollButton v-if="editorBodyRef" :scroll-container="editorBodyRef" :bottom="16" :right="16" />

    <!-- AI Drawer (Teleport to body, outside flex flow) -->
    <AiPanel v-if="showAiPanel" :project-id="projectId" :chapter-id="chapterId" @insert="onAiInsert"
      @import-selection="onAiImport" @close="showAiPanel = false" />
  </div>
</template>

<style scoped>
.editor-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
}



/* 阻止免费聊天内容撑破 body 产生外层滚动条 */
:global(body:has(.editor-page)) {
  overflow: hidden;
}
.btn-back {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  transition: color 0.15s;
}

.btn-back:hover {
  color: var(--text);
}

.title-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  outline: none;
  letter-spacing: -0.3px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.saving {
  color: var(--warning);
}

.saved {
  color: var(--success);
}

.btn-ai {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
}

.btn-ai.active,
.btn-ai:hover {
  background: var(--text);
  color: var(--bg-card);
  border-color: var(--text);
}

.btn-free {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1px solid var(--success);
  background: transparent;
  color: var(--success);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
}

.btn-free:hover {
  background: var(--success);
  color: #fff;
}

.editor-body {
  overflow-y: auto;
  padding: 24px 48px;
  background: var(--bg);
  height: calc(100vh - 56px - 45px);
}

.editor-main {
  min-width: 0;
}
</style>
