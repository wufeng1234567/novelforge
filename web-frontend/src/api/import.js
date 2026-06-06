import client from './client'

export const importApi = {
  /**
   * 导入结构化数据到项目
   * @param {string} projectId - 项目 ID
   * @param {object} data - 包含 world_modules, world_rules, characters, relationships + clear_* 标志
   * @returns {Promise<{data: ImportResult}>}
   */
  importData(projectId, data) {
    return client.post(`/import/${projectId}`, data)
  },

  /**
   * 获取项目已有设定摘要（用于冲突检测）
   * @param {string} projectId - 项目 ID
   * @returns {Promise<{data: ProjectSettingsSummary}>}
   */
  getProjectSettings(projectId) {
    return client.get(`/import/${projectId}/settings`)
  },

  /**
   * 获取项目完整上下文（格式化为提示词）
   * @param {string} projectId - 项目 ID
   * @returns {Promise<{data: {context: string}}>}
   */
  getFullContext(projectId) {
    return client.get(`/import/${projectId}/full-context`)
  }
}
