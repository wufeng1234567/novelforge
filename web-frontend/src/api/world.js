import client from './client'

export const MODULE_TYPES = [
  { value: 'era', label: '时代背景' },
  { value: 'geography', label: '地理环境' },
  { value: 'magic', label: '超凡体系' },
  { value: 'politics', label: '政治体系' },
  { value: 'race', label: '种族设定' },
  { value: 'religion', label: '宗教信仰' },
  { value: 'history', label: '历史事件' },
  { value: 'culture', label: '社会文化' },
  { value: 'economy', label: '经济体系' },
]

export const worldApi = {
  listModules(projectId, moduleType) {
    const params = moduleType ? { module_type: moduleType } : {}
    return client.get(`/projects/${projectId}/world`, { params })
  },
  createModule(projectId, data) {
    return client.post(`/projects/${projectId}/world`, data)
  },
  updateModule(projectId, moduleId, data) {
    return client.put(`/projects/${projectId}/world/${moduleId}`, data)
  },
  deleteModule(projectId, moduleId) {
    return client.delete(`/projects/${projectId}/world/${moduleId}`)
  },
  deleteModulesBatch(projectId) {
    return client.delete(`/projects/${projectId}/world/batch`)
  },
  listRules(projectId) {
    return client.get(`/projects/${projectId}/world-rules`)
  },
  createRule(projectId, data) {
    return client.post(`/projects/${projectId}/world-rules`, data)
  },
  updateRule(projectId, ruleId, data) {
    return client.put(`/projects/${projectId}/world-rules/${ruleId}`, data)
  },
  deleteRule(projectId, ruleId) {
    return client.delete(`/projects/${projectId}/world-rules/${ruleId}`)
  },
  deleteRulesBatch(projectId) {
    return client.delete(`/projects/${projectId}/world-rules/batch`)
  },
}
