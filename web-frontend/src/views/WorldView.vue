<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { worldApi, MODULE_TYPES } from '../api/world'
import RichTextEditor from '../components/RichTextEditor.vue'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id

const activeTab = ref('era')
const modules = ref([])
const rules = ref([])
const editingModule = ref(null)
const showModuleForm = ref(false)
const moduleForm = ref({ title: '', content: '', tags: '' })
const showRuleForm = ref(false)
const editingRule = ref(null)
const ruleForm = ref({ content: '', priority: 0 })
const selectedRules = ref([])

const currentModule = computed(() =>
  modules.value.find(m => m.module_type === activeTab.value)
)

async function loadModules() {
  const { data } = await worldApi.listModules(projectId)
  modules.value = data
}

async function loadRules() {
  const { data } = await worldApi.listRules(projectId)
  rules.value = data
}

onMounted(() => {
  loadModules()
  loadRules()
})

function switchTab(type) {
  activeTab.value = type
  editingModule.value = null
  showModuleForm.value = false
}

function startEdit() {
  if (currentModule.value) {
    editingModule.value = currentModule.value
    moduleForm.value = {
      title: currentModule.value.title,
      content: currentModule.value.content,
      tags: currentModule.value.tags || ''
    }
  } else {
    editingModule.value = null
    moduleForm.value = { title: '', content: '', tags: '' }
  }
  showModuleForm.value = true
}

async function saveModule() {
  if (editingModule.value) {
    await worldApi.updateModule(projectId, editingModule.value.id, moduleForm.value)
  } else {
    await worldApi.createModule(projectId, {
      module_type: activeTab.value,
      ...moduleForm.value
    })
  }
  showModuleForm.value = false
  await loadModules()
}

async function deleteModule(id) {
  if (!id) {
    alert('模块 ID 不存在，请刷新页面后重试')
    return
  }
  if (!confirm('确定删除？')) return
  try {
    await worldApi.deleteModule(projectId, id)
    await loadModules()
  } catch (e) {
    alert('删除失败: ' + (e.message || '未知错误'))
  }
}

function handleModuleDelete() {
  const module = currentModule.value
  if (module) {
    deleteModule(module.id)
  }
}

function startAddRule() {
  editingRule.value = null
  ruleForm.value = { content: '', priority: 0 }
  showRuleForm.value = true
}

function startEditRule(rule) {
  editingRule.value = rule.id
  ruleForm.value = { content: rule.content, priority: rule.priority }
  showRuleForm.value = true
}

async function saveRule() {
  if (editingRule.value) {
    await worldApi.updateRule(projectId, editingRule.value, ruleForm.value)
  } else {
    await worldApi.createRule(projectId, ruleForm.value)
  }
  showRuleForm.value = false
  editingRule.value = null
  ruleForm.value = { content: '', priority: 0 }
  await loadRules()
}

async function deleteRule(id) {
  if (!confirm('确定删除？')) return
  await worldApi.deleteRule(projectId, id)
  await loadRules()
}

function toggleSelectRule(id) {
  const idx = selectedRules.value.indexOf(id)
  if (idx >= 0) {
    selectedRules.value.splice(idx, 1)
  } else {
    selectedRules.value.push(id)
  }
}

async function deleteSelectedRules() {
  if (!confirm(`确定删除选中的 ${selectedRules.value.length} 条规则？`)) return
  await worldApi.deleteRulesBatch(projectId)
  selectedRules.value = []
  await loadRules()
}

async function deleteAllModules() {
  if (!confirm(`确定删除所有 ${modules.value.length} 个世界观模块？此操作不可恢复！`)) return
  await worldApi.deleteModulesBatch(projectId)
  await loadModules()
}

async function deleteAllRules() {
  if (!confirm(`确定删除所有 ${rules.value.length} 条规则？此操作不可恢复！`)) return
  await worldApi.deleteRulesBatch(projectId)
  await loadRules()
}

function cancelRuleEdit() {
  showRuleForm.value = false
  editingRule.value = null
  ruleForm.value = { content: '', priority: 0 }
}

function onEditorUpdate({ html }) {
  moduleForm.value.content = html
}

const typeLabel = (type) => MODULE_TYPES.find(t => t.value === type)?.label || type
</script>

<template>
  <div class="world-view">
    <div class="view-header">
      <button class="btn-back" @click="router.push(`/project/${projectId}`)">&larr; 返回</button>
      <h2>世界观设定</h2>
    </div>

    <!-- Module Type Tabs -->
    <div class="type-tabs">
      <button
        v-for="t in MODULE_TYPES"
        :key="t.value"
        :class="{ active: activeTab === t.value, hasData: modules.some(m => m.module_type === t.value) }"
        @click="switchTab(t.value)"
      >{{ t.label }}</button>
      <button v-if="modules.length > 0" class="btn-sm btn-danger" style="margin-left:auto" @click="deleteAllModules">
        清空所有世界观
      </button>
    </div>

    <!-- Module Content -->
    <div class="module-content">
      <div v-if="!showModuleForm" class="module-display">
        <div v-if="currentModule" class="module-card">
          <div class="module-header">
            <h3>{{ currentModule.title || typeLabel(activeTab) }}</h3>
            <div class="module-actions">
              <button class="btn-sm" @click="startEdit">编辑</button>
              <button class="btn-sm btn-danger" @click.stop="handleModuleDelete">删除</button>
            </div>
          </div>
          <div v-if="currentModule.tags" class="tags">
            <span v-for="tag in currentModule.tags.split(',')" :key="tag" class="tag">{{ tag.trim() }}</span>
          </div>
          <div class="module-body" v-html="currentModule.content || '<p class=empty>暂无内容</p>'"></div>
        </div>
        <div v-else class="empty-state">
          <p>尚未创建「{{ typeLabel(activeTab) }}」模块</p>
          <button class="btn-primary" style="width:auto;padding:8px 20px" @click="startEdit">创建</button>
        </div>
      </div>

      <!-- Edit/Create Form -->
      <div v-else class="module-form">
        <div class="form-group">
          <label>标题</label>
          <input v-model="moduleForm.title" :placeholder="typeLabel(activeTab) + ' 标题'" />
        </div>
        <div class="form-group">
          <label>标签（逗号分隔）</label>
          <input v-model="moduleForm.tags" placeholder="例如：东方,修仙,上古" />
        </div>
        <div class="form-group">
          <label>内容</label>
          <RichTextEditor :content="moduleForm.content" @update="onEditorUpdate" />
        </div>
        <div class="form-actions">
          <button class="btn-secondary" @click="showModuleForm = false">取消</button>
          <button class="btn-primary" style="width:auto;padding:8px 24px" @click="saveModule">保存</button>
        </div>
      </div>
    </div>

    <!-- World Rules Section -->
    <div class="rules-section">
      <div class="section-header">
        <h3>硬规则</h3>
        <div class="rules-actions">
          <button v-if="selectedRules.length > 0" class="btn-sm btn-danger" @click="deleteSelectedRules">
            删除选中 ({{ selectedRules.length }})
          </button>
          <button v-if="rules.length > 0" class="btn-sm btn-danger" @click="deleteAllRules">
            清空所有规则
          </button>
          <button class="btn-sm" @click="startAddRule">+ 添加规则</button>
        </div>
      </div>

      <div v-if="showRuleForm" class="rule-form">
        <input v-model="ruleForm.content" placeholder="输入规则内容" style="flex:1" />
        <input v-model.number="ruleForm.priority" type="number" placeholder="优先级" style="width:80px" />
        <button class="btn-sm" @click="saveRule">保存</button>
        <button class="btn-sm" @click="cancelRuleEdit">取消</button>
      </div>

      <div class="rule-list">
        <div v-for="rule in rules" :key="rule.id" class="rule-item">
          <input
            type="checkbox"
            :checked="selectedRules.includes(rule.id)"
            @change="toggleSelectRule(rule.id)"
            class="rule-checkbox"
          />
          <span class="rule-content">{{ rule.content }}</span>
          <span class="rule-priority">P{{ rule.priority }}</span>
          <button class="btn-sm" @click="startEditRule(rule)">编辑</button>
          <button class="btn-sm btn-danger" @click="deleteRule(rule.id)">删除</button>
        </div>
        <p v-if="!rules.length" class="empty-text">暂无硬规则</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.world-view { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
.view-header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
.view-header h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
.btn-back { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px; }
.btn-back:hover { color: var(--text); }
.type-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 24px; }
.type-tabs button {
  padding: 7px 14px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; cursor: pointer; font-size: 13px; color: var(--text-secondary);
  transition: all 0.15s;
}
.type-tabs button:hover { border-color: var(--border-hover); color: var(--text); }
.type-tabs button.active { background: var(--text); color: var(--bg-card); border-color: var(--text); }
.type-tabs button.hasData::after { content: ' \2022'; color: var(--success); }
.module-content { margin-bottom: 40px; }
.module-card {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px;
}
.module-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.module-header h3 { font-size: 16px; font-weight: 600; }
.module-actions { display: flex; gap: 6px; }
.btn-sm {
  padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px;
  background: transparent; cursor: pointer; font-size: 12px; color: var(--text-secondary);
}
.btn-sm:hover { border-color: var(--border-hover); color: var(--text); }
.btn-danger:hover { border-color: var(--danger); color: var(--danger); }
.tags { display: flex; gap: 6px; margin-bottom: 12px; }
.tag {
  padding: 2px 8px; background: var(--bg-hover); border-radius: 4px;
  font-size: 11px; color: var(--text-secondary);
}
.module-body { font-size: 14px; line-height: 1.8; }
.module-body :deep(p) { margin-bottom: 8px; }
.empty-state { text-align: center; padding: 48px 20px; color: var(--text-secondary); }
.empty-state p { margin-bottom: 16px; }
.module-form { display: flex; flex-direction: column; gap: 16px; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-size: 12px; font-weight: 500; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.form-group input { padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; }
.form-group input:focus { outline: none; border-color: var(--text); }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn-secondary { padding: 8px 16px; border: 1px solid var(--border); border-radius: 6px; background: transparent; cursor: pointer; font-size: 14px; }
.btn-primary { padding: 8px 24px; border: none; border-radius: 6px; background: var(--text); color: var(--bg-card); cursor: pointer; font-size: 14px; }
.rules-section { margin-top: 32px; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
.section-header h3 { font-size: 16px; font-weight: 600; }
.rules-actions { display: flex; gap: 8px; align-items: center; }
.rule-form { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.rule-form input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.rule-form input:focus { outline: none; border-color: var(--text); }
.rule-list { display: flex; flex-direction: column; gap: 6px; }
.rule-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px;
}
.rule-checkbox { width: 16px; height: 16px; cursor: pointer; }
.rule-content { flex: 1; font-size: 14px; }
.rule-priority { font-size: 12px; color: var(--text-secondary); }
.empty-text { color: var(--text-secondary); font-size: 13px; }
</style>
