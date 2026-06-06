<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const store = useProjectStore()
const auth = useAuthStore()

const showCreate = ref(false)
const form = ref({ title: '', description: '', genre: '' })
const search = ref('')

onMounted(() => store.fetchProjects())

async function handleCreate() {
  const project = await store.createProject(form.value)
  showCreate.value = false
  form.value = { title: '', description: '', genre: '' }
  router.push(`/project/${project.id}`)
}

async function handleSearch() {
  await store.fetchProjects({ search: search.value || undefined })
}

function goToProject(id) {
  router.push(`/project/${id}`)
}
</script>

<template>
  <div class="dashboard">
    <div class="dashboard-header">
      <div>
        <h2>我的项目</h2>
        <p class="welcome">欢迎回来，{{ auth.user?.nickname || auth.user?.username }}</p>
      </div>
      <div class="actions">
        <div class="search-box">
          <input v-model="search" placeholder="搜索项目..." @keyup.enter="handleSearch" />
        </div>
        <button class="btn-primary" @click="showCreate = true">+ 新建项目</button>
      </div>
    </div>

    <!-- Create Project Modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <h3>新建项目</h3>
        <form @submit.prevent="handleCreate">
          <div class="form-group">
            <label>标题</label>
            <input v-model="form.title" placeholder="项目标题" required />
          </div>
          <div class="form-group">
            <label>简介</label>
            <textarea v-model="form.description" placeholder="项目简介" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>类型</label>
            <select v-model="form.genre">
              <option value="">请选择</option>
              <option>玄幻</option>
              <option>仙侠</option>
              <option>都市</option>
              <option>科幻</option>
              <option>历史</option>
              <option>悬疑</option>
              <option>言情</option>
              <option>其他</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="showCreate = false">取消</button>
            <button type="submit" class="btn-primary">创建</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Project List -->
    <div v-if="store.projects.length" class="project-grid">
      <div
        v-for="project in store.projects"
        :key="project.id"
        class="project-card"
        @click="goToProject(project.id)"
      >
        <h3>{{ project.title }}</h3>
        <p class="desc">{{ project.description || '暂无简介' }}</p>
        <div class="meta">
          <span v-if="project.genre" class="genre-tag">{{ project.genre }}</span>
          <span class="date">{{ new Date(project.updated_at).toLocaleDateString() }}</span>
        </div>
      </div>
    </div>
    <div v-else class="empty">
      <p>还没有项目，点击上方按钮创建第一个吧</p>
    </div>
  </div>
</template>
