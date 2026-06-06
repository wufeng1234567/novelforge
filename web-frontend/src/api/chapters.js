import client from './client'

export const chaptersApi = {
  list(projectId) {
    return client.get(`/projects/${projectId}/chapters`)
  },
  get(projectId, chapterId) {
    return client.get(`/projects/${projectId}/chapters/${chapterId}`)
  },
  create(projectId, data) {
    return client.post(`/projects/${projectId}/chapters`, data)
  },
  update(projectId, chapterId, data) {
    return client.put(`/projects/${projectId}/chapters/${chapterId}`, data)
  },
  delete(projectId, chapterId) {
    return client.delete(`/projects/${projectId}/chapters/${chapterId}`)
  },
  getVersions(projectId, chapterId) {
    return client.get(`/projects/${projectId}/chapters/${chapterId}/versions`)
  }
}
