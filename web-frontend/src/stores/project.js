import { defineStore } from 'pinia'
import { ref } from 'vue'
import { projectsApi } from '../api/projects'
import { chaptersApi } from '../api/chapters'

export const useProjectStore = defineStore('project', () => {
  const projects = ref([])
  const currentProject = ref(null)
  const chapters = ref([])
  const currentChapter = ref(null)
  const total = ref(0)
  const page = ref(1)

  async function fetchProjects(params = {}) {
    const { data } = await projectsApi.list({ page: page.value, page_size: 20, ...params })
    projects.value = data.items
    total.value = data.total
  }

  async function fetchProject(id) {
    const { data } = await projectsApi.get(id)
    currentProject.value = data
  }

  async function createProject(form) {
    const { data } = await projectsApi.create(form)
    projects.value.unshift(data)
    return data
  }

  async function updateProject(id, form) {
    const { data } = await projectsApi.update(id, form)
    const idx = projects.value.findIndex(p => p.id === id)
    if (idx !== -1) projects.value[idx] = data
    if (currentProject.value?.id === id) currentProject.value = data
    return data
  }

  async function deleteProject(id) {
    await projectsApi.delete(id)
    projects.value = projects.value.filter(p => p.id !== id)
  }

  async function fetchChapters(projectId) {
    const { data } = await chaptersApi.list(projectId)
    chapters.value = data.items
  }

  async function fetchChapter(projectId, chapterId) {
    const { data } = await chaptersApi.get(projectId, chapterId)
    currentChapter.value = data
    return data
  }

  async function createChapter(projectId, form) {
    const { data } = await chaptersApi.create(projectId, form)
    chapters.value.push(data)
    return data
  }

  async function updateChapter(projectId, chapterId, form) {
    const { data } = await chaptersApi.update(projectId, chapterId, form)
    const idx = chapters.value.findIndex(c => c.id === chapterId)
    if (idx !== -1) chapters.value[idx] = data
    if (currentChapter.value?.id === chapterId) currentChapter.value = data
    return data
  }

  async function deleteChapter(projectId, chapterId) {
    await chaptersApi.delete(projectId, chapterId)
    chapters.value = chapters.value.filter(c => c.id !== chapterId)
    if (currentChapter.value?.id === chapterId) currentChapter.value = null
  }

  return {
    projects, currentProject, chapters, currentChapter, total, page,
    fetchProjects, fetchProject, createProject, updateProject, deleteProject,
    fetchChapters, fetchChapter, createChapter, updateChapter, deleteChapter
  }
})
