<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'

const route = useRoute()
const router = useRouter()
const store = useProjectStore()
const projectId = route.params.id

const showCreateChapter = ref(false)
const chapterForm = ref({ title: '' })

onMounted(async () => {
  await store.fetchProject(projectId)
  await store.fetchChapters(projectId)
})

async function handleCreateChapter() {
  const chapter = await store.createChapter(projectId, { title: chapterForm.value.title })
  showCreateChapter.value = false
  chapterForm.value.title = ''
  router.push(`/project/${projectId}/chapter/${chapter.id}`)
}

async function handleDeleteChapter(chapterId) {
  if (!confirm('确定删除此章节？')) return
  await store.deleteChapter(projectId, chapterId)
}

function openEditor(chapterId) {
  router.push(`/project/${projectId}/chapter/${chapterId}`)
}
</script>

<template>
  <div class="project-view" v-if="store.currentProject">
    <div class="project-header">
      <button class="btn-back" @click="router.push('/')">&larr; 返回</button>
      <div>
        <h2>{{ store.currentProject.title }}</h2>
        <p class="desc">{{ store.currentProject.description }}</p>
      </div>
      <div class="header-actions">
        <button class="btn-outline" @click="router.push(`/project/${projectId}/world`)">世界观</button>
        <button class="btn-outline" @click="router.push(`/project/${projectId}/characters`)">角色</button>
        <button class="btn-outline" @click="router.push(`/project/${projectId}/free-mode`)">免费模式</button>
        <button class="btn-primary" @click="showCreateChapter = true">+ 新建章节</button>
      </div>
    </div>

    <!-- Create Chapter Modal -->
    <div v-if="showCreateChapter" class="modal-overlay" @click.self="showCreateChapter = false">
      <div class="modal">
        <h3>新建章节</h3>
        <form @submit.prevent="handleCreateChapter">
          <div class="form-group">
            <label>章节标题</label>
            <input v-model="chapterForm.title" placeholder="例如：第一章 开端" required />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="showCreateChapter = false">取消</button>
            <button type="submit" class="btn-primary">创建</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Chapter List -->
    <div class="chapter-list">
      <div
        v-for="chapter in store.chapters"
        :key="chapter.id"
        class="chapter-item"
      >
        <div class="chapter-info" @click="openEditor(chapter.id)">
          <span class="chapter-number">第{{ chapter.chapter_number }}章</span>
          <span class="chapter-title">{{ chapter.title || '未命名' }}</span>
          <span class="word-count">{{ chapter.word_count }} 字</span>
        </div>
        <button class="btn-delete" @click.stop="handleDeleteChapter(chapter.id)">删除</button>
      </div>
      <div v-if="!store.chapters.length" class="empty">
        <p>暂无章节，点击上方按钮创建</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header-actions { display: flex; gap: 8px; align-items: center; }
.btn-outline {
  padding: 7px 14px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 13px;
  transition: all 0.15s;
}
.btn-outline:hover { border-color: var(--border-hover); color: var(--text); }
</style>
