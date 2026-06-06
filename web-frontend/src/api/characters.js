import client from './client'

export const charactersApi = {
  list(projectId) {
    return client.get(`/projects/${projectId}/characters`)
  },
  get(projectId, charId) {
    return client.get(`/projects/${projectId}/characters/${charId}`)
  },
  create(projectId, data) {
    return client.post(`/projects/${projectId}/characters`, data)
  },
  update(projectId, charId, data) {
    return client.put(`/projects/${projectId}/characters/${charId}`, data)
  },
  delete(projectId, charId) {
    return client.delete(`/projects/${projectId}/characters/${charId}`)
  },
  deleteBatch(projectId) {
    return client.delete(`/projects/${projectId}/characters/batch`)
  },
  listRelationships(projectId) {
    return client.get(`/projects/${projectId}/characters/relationships`)
  },
  createRelationship(projectId, data) {
    return client.post(`/projects/${projectId}/characters/relationships`, data)
  },
  updateRelationship(projectId, relId, data) {
    return client.put(`/projects/${projectId}/characters/relationships/${relId}`, data)
  },
  deleteRelationship(projectId, relId) {
    return client.delete(`/projects/${projectId}/characters/relationships/${relId}`)
  },
  deleteRelationshipsBatch(projectId) {
    return client.delete(`/projects/${projectId}/characters/relationships/batch`)
  },
}
