/**
 * AI 生成设定工具模块
 * 提取自 extension/content/inject.js，前后端共享
 */

// 世界观模块类型中文映射
export const MODULE_LABELS = {
  era: '时代背景',
  geography: '地理环境',
  magic: '超凡体系',
  politics: '政治体系',
  race: '种族设定',
  religion: '宗教信仰',
  history: '历史事件',
  culture: '社会文化',
  economy: '经济体系'
}

// 生成类型
export const GENERATE_TYPES = {
  world: '世界观设定',
  characters: '角色设定',
  relationships: '角色关系',
  all: '完整生成'
}

/**
 * 从 AI 回复文本中提取 JSON 对象
 * 支持：```json 代码块、裸 JSON、混合文本中的 JSON、带注释的 JSON
 * @param {string} text - AI 回复文本
 * @returns {object|null} 解析后的 JSON 对象，失败返回 null
 */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') return null

  const _log = (msg) => console.log(`[extractJSON] ${msg}`)

  _log(`输入: len=${text.length}, 前100字: ${text.slice(0, 100).replace(/\n/g, '\\n')}`)

  // 1. 清理代码块标记（支持多种格式）
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .replace(/^\s*json\s*\n/gi, '') // 去掉开头的 "json" 标记
    .trim()

  // 2. 去掉行尾注释 (// ...)
  cleaned = cleaned.replace(/\/\/.*$/gm, '')

  _log(`清理后: len=${cleaned.length}, 前100字: ${cleaned.slice(0, 100).replace(/\n/g, '\\n')}`)

  // 3. 尝试直接解析
  try {
    const result = JSON.parse(cleaned)
    if (typeof result === 'object' && result !== null) {
      _log(`✅ 步骤3直接解析成功`)
      return result
    }
  } catch (e) {
    _log(`步骤3直接解析失败: ${e.message.slice(0, 80)}`)
  }

  // 4. 提取第一个 { 到最后一个 } 之间的内容
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  _log(`步骤4: 第一个{位置=${start}, 最后一个}位置=${end}`)
  if (start !== -1 && end > start) {
    const jsonStr = cleaned.substring(start, end + 1)
    _log(`步骤4: 提取片段 len=${jsonStr.length}, 前80字: ${jsonStr.slice(0, 80).replace(/\n/g, '\\n')}`)
    try {
      const result = JSON.parse(jsonStr)
      if (typeof result === 'object' && result !== null) {
        _log(`✅ 步骤4提取解析成功`)
        return result
      }
    } catch (e) {
      _log(`步骤4提取解析失败: ${e.message.slice(0, 80)}`)
    }

    // 4b. 尝试修复常见 JSON 问题（尾逗号、单引号等）
    try {
      const fixed = jsonStr
        .replace(/,\s*([}\]])/g, '$1') // 去掉尾逗号
        .replace(/'/g, '"') // 单引号换双引号
      const result = JSON.parse(fixed)
      if (typeof result === 'object' && result !== null) {
        _log(`✅ 步骤4b修复解析成功`)
        return result
      }
    } catch (e) {
      _log(`步骤4b修复解析失败: ${e.message.slice(0, 80)}`)
    }
  }

  // 5. 尝试匹配 ```...``` 代码块内容
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (codeBlockMatch) {
    const blockContent = codeBlockMatch[1].trim()
    _log(`步骤5: 找到代码块, len=${blockContent.length}`)
    try {
      const result = JSON.parse(blockContent)
      if (typeof result === 'object' && result !== null) {
        _log(`✅ 步骤5代码块解析成功`)
        return result
      }
    } catch (e) {
      _log(`步骤5代码块解析失败: ${e.message.slice(0, 80)}`)
      // 尝试从代码块中提取 JSON
      const bs = blockContent.indexOf('{')
      const be = blockContent.lastIndexOf('}')
      if (bs !== -1 && be > bs) {
        try {
          const result = JSON.parse(blockContent.substring(bs, be + 1))
          if (typeof result === 'object' && result !== null) {
            _log(`✅ 步骤5代码块提取解析成功`)
            return result
          }
        } catch (e2) {
          _log(`步骤5代码块提取解析失败: ${e2.message.slice(0, 80)}`)
        }
      }
    }
  } else {
    _log(`步骤5: 未找到代码块`)
  }

  _log(`❌ 所有步骤均失败，返回 null`)
  return null
}

/**
 * 校验导入数据是否包含有效内容
 * @param {object} json - 解析后的 JSON
 * @returns {{ valid: boolean, types: string[] }} 是否有效 + 包含的数据类型
 */
export function validateImportData(json) {
  if (!json || typeof json !== 'object') return { valid: false, types: [] }

  const types = []
  if (Array.isArray(json.world_modules) && json.world_modules.length > 0) types.push('world_modules')
  if (Array.isArray(json.world_rules) && json.world_rules.length > 0) types.push('world_rules')
  if (Array.isArray(json.characters) && json.characters.length > 0) types.push('characters')
  if (Array.isArray(json.relationships) && json.relationships.length > 0) types.push('relationships')

  return { valid: types.length > 0, types }
}

/**
 * 构建生成设定的完整提示词（含 JSON 格式要求）
 * @param {string} type - 生成类型：world | characters | relationships | all
 * @param {string[]} moduleTypes - 世界观模块类型（仅 world/all 有效）
 * @param {string} userHint - 用户补充说明
 * @param {string} mode - 导入模式：overwrite | append
 * @param {string} projectContext - 项目已有上下文（可选，追加模式下使用）
 * @returns {string} 完整提示词
 */
export function buildGeneratePrompt(type, moduleTypes = [], userHint = '', mode = 'overwrite', projectContext = '') {
  const selectedModules = moduleTypes.length > 0
    ? moduleTypes
    : Object.keys(MODULE_LABELS)

  const selectedLabels = selectedModules.map(m => MODULE_LABELS[m] || m).join('、')

  let instruction = ''
  let jsonFormat = ''

  if (type === 'world') {
    instruction = `请生成以下世界观模块：${selectedLabels}。`
    jsonFormat = `{
  "world_modules": [
    {
      "module_type": "${selectedModules.join('|')}",
      "title": "模块标题",
      "content": "详细的Markdown内容（请使用 Markdown 格式，包含标题、段落、列表等）",
      "tags": "标签1,标签2"
    }
  ],
  "world_rules": [
    { "content": "硬规则内容", "priority": 1 }
  ]
}`
  } else if (type === 'characters') {
    instruction = '请生成角色设定。'
    jsonFormat = `{
  "characters": [
    {
      "name": "角色名",
      "gender": "性别",
      "age": "年龄",
      "appearance": "外貌描述（Markdown格式）",
      "personality": "性格描述（Markdown格式）",
      "abilities": "能力/技能（Markdown格式）",
      "background": "背景故事（Markdown格式）",
      "status": "当前状态",
      "quotes": "经典语录"
    }
  ]
}`
  } else if (type === 'relationships') {
    instruction = '请生成角色关系。'
    jsonFormat = `{
  "relationships": [
    {
      "from_name": "角色A的名字",
      "to_name": "角色B的名字",
      "relation_type": "关系类型(亲人/朋友/敌人/恋人/师徒/上下级/盟友/宿敌)",
      "intimacy": 50,
      "description": "关系描述"
    }
  ]
}`
  } else {
    // all
    instruction = `请生成完整的世界观设定（${selectedLabels}）、角色、角色关系和硬规则。`
    jsonFormat = `{
  "world_modules": [
    { "module_type": "era|geography|magic|politics|race|religion|history|culture|economy", "title": "标题", "content": "Markdown格式内容", "tags": "标签" }
  ],
  "world_rules": [
    { "content": "硬规则内容", "priority": 1 }
  ],
  "characters": [
    { "name": "角色名", "gender": "", "age": "", "appearance": "", "personality": "", "abilities": "", "background": "", "status": "", "quotes": "" }
  ],
  "relationships": [
    { "from_name": "角色A", "to_name": "角色B", "relation_type": "朋友", "intimacy": 80, "description": "" }
  ]
}`
  }

  let prompt = ''

  // 追加模式：附带已有项目上下文，让 AI 在此基础上补充
  if (mode === 'append' && projectContext) {
    prompt += `以下是当前小说项目的已有设定，请在此基础上补充新的内容，不要重复已有设定，只输出新增的部分：\n\n${projectContext}\n\n---\n\n`
  }

  // 覆盖模式：附带已有上下文作为参考，生成全新的完整设定
  if (mode === 'overwrite' && projectContext) {
    prompt += `以下是当前小说项目的已有设定，请参考其风格和设定逻辑，生成全新的完整设定来替代已有内容：\n\n${projectContext}\n\n---\n\n`
  }

  if (userHint) {
    prompt += `用户要求：${userHint}\n\n`
  }
  prompt += `${instruction}\n\n请严格按照以下JSON格式返回，只返回纯JSON，不要其他文字。内容请使用 Markdown 格式书写，确保内容丰富、详细、有逻辑性：\n\n${jsonFormat}`

  return prompt
}

/**
 * 统计导入数据中各类型的数量
 * @param {object} json - 解析后的 JSON
 * @returns {object} 各类型数量
 */
export function countImportData(json) {
  return {
    world_modules: json.world_modules?.length || 0,
    world_rules: json.world_rules?.length || 0,
    characters: json.characters?.length || 0,
    relationships: json.relationships?.length || 0
  }
}

/**
 * 检测导入数据与已有设定的冲突
 * @param {object} importData - 要导入的数据
 * @param {object} existingSettings - 项目已有设定
 * @returns {object} 冲突信息
 */
export function detectConflicts(importData, existingSettings) {
  const conflicts = {}

  // 世界观模块冲突（按 module_type 检测）
  if (importData.world_modules?.length > 0 && existingSettings.world_modules?.length > 0) {
    const existingTypes = existingSettings.world_modules.map(m => m.module_type)
    const importTypes = [...new Set(importData.world_modules.map(m => m.module_type))]
    const overlap = importTypes.filter(t => existingTypes.includes(t))
    if (overlap.length > 0) {
      const labels = overlap.map(t => MODULE_LABELS[t] || t).join('、')
      conflicts.world_modules = `已有 ${overlap.length} 个同类模块（${labels}），覆盖将删除旧数据`
    }
  }

  // 硬规则冲突
  if (importData.world_rules?.length > 0 && existingSettings.world_rules?.length > 0) {
    conflicts.world_rules = `已有 ${existingSettings.world_rules.length} 条硬规则，覆盖将全部替换`
  }

  // 角色冲突（按名字检测）
  if (importData.characters?.length > 0 && existingSettings.characters?.length > 0) {
    const existingNames = existingSettings.characters.map(c => c.name)
    const importNames = importData.characters.map(c => c.name)
    const overlap = importNames.filter(n => existingNames.includes(n))
    if (overlap.length > 0) {
      conflicts.characters = `已有同名角色：${overlap.join('、')}，覆盖将更新其信息`
    }
  }

  // 关系冲突
  if (importData.relationships?.length > 0 && existingSettings.relationships?.length > 0) {
    conflicts.relationships = `已有 ${existingSettings.relationships.length} 条关系，覆盖将全部替换`
  }

  return conflicts
}
