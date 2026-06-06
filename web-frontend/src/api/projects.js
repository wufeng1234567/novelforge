import client from './client'

export const projectsApi = {
  list(params = {}) {
    return client.get('/projects', { params })
  },
  get(id) {
    return client.get(`/projects/${id}`)
  },
  create(data) {
    return client.post('/projects', data)
  },
  update(id, data) {
    return client.put(`/projects/${id}`, data)
  },
  delete(id) {
    return client.delete(`/projects/${id}`)
  },
  getSettings(id) {
    return client.get(`/projects/${id}/settings`)
  },
  updateSettings(id, data) {
    return client.put(`/projects/${id}/settings`, data)
  }
}
