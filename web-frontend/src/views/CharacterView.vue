<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { charactersApi } from '../api/characters'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id

const characters = ref([])
const relationships = ref([])
const showCharForm = ref(false)
const editingChar = ref(null)
const charForm = ref({
  name: '', gender: '', age: '', appearance: '', personality: '',
  abilities: '', background: '', status: '', quotes: ''
})
const showRelForm = ref(false)
const editingRel = ref(null)
const relForm = ref({ from_char_id: '', to_char_id: '', relation_type: '', intimacy: 50, description: '' })

const RELATION_TYPES = ['亲人', '朋友', '敌人', '恋人', '师徒', '上下级', '盟友', '宿敌', '其他']

async function load() {
  const [cRes, rRes] = await Promise.all([
    charactersApi.list(projectId),
    charactersApi.listRelationships(projectId)
  ])
  characters.value = cRes.data
  relationships.value = rRes.data
}

onMounted(load)

function getCharName(id) {
  return characters.value.find(c => c.id === id)?.name || '?'
}

function startCreate() {
  editingChar.value = null
  charForm.value = { name: '', gender: '', age: '', appearance: '', personality: '', abilities: '', background: '', status: '', quotes: '' }
  showCharForm.value = true
}

function startEdit(char) {
  editingChar.value = char
  charForm.value = {
    name: char.name, gender: char.gender || '', age: char.age || '',
    appearance: char.appearance || '', personality: char.personality || '',
    abilities: char.abilities || '', background: char.background || '',
    status: char.status || '', quotes: char.quotes || ''
  }
  showCharForm.value = true
}

async function saveChar() {
  if (editingChar.value) {
    await charactersApi.update(projectId, editingChar.value.id, charForm.value)
  } else {
    await charactersApi.create(projectId, charForm.value)
  }
  showCharForm.value = false
  await load()
}

async function deleteChar(id) {
  if (!confirm('确定删除此角色？')) return
  await charactersApi.delete(projectId, id)
  await load()
}

async function deleteAllCharacters() {
  if (!confirm(`确定删除所有 ${characters.value.length} 个角色？此操作不可恢复！`)) return
  await charactersApi.deleteBatch(projectId)
  await load()
}

function startAddRel() {
  editingRel.value = null
  relForm.value = { from_char_id: '', to_char_id: '', relation_type: '', intimacy: 50, description: '' }
  showRelForm.value = true
}

function startEditRel(rel) {
  editingRel.value = rel.id
  relForm.value = {
    from_char_id: rel.from_char_id,
    to_char_id: rel.to_char_id,
    relation_type: rel.relation_type,
    intimacy: rel.intimacy,
    description: rel.description || ''
  }
  showRelForm.value = true
}

async function saveRel() {
  if (editingRel.value) {
    await charactersApi.updateRelationship(projectId, editingRel.value, relForm.value)
  } else {
    await charactersApi.createRelationship(projectId, relForm.value)
  }
  showRelForm.value = false
  editingRel.value = null
  relForm.value = { from_char_id: '', to_char_id: '', relation_type: '', intimacy: 50, description: '' }
  await load()
}

function cancelRelEdit() {
  showRelForm.value = false
  editingRel.value = null
  relForm.value = { from_char_id: '', to_char_id: '', relation_type: '', intimacy: 50, description: '' }
}

async function deleteRel(id) {
  if (!confirm('确定删除此关系？')) return
  await charactersApi.deleteRelationship(projectId, id)
  await load()
}

async function deleteAllRelationships() {
  if (!confirm(`确定删除所有 ${relationships.value.length} 条角色关系？此操作不可恢复！`)) return
  await charactersApi.deleteRelationshipsBatch(projectId)
  await load()
}
</script>

<template>
  <div class="character-view">
    <div class="view-header">
      <button class="btn-back" @click="router.push(`/project/${projectId}`)">&larr; 返回</button>
      <h2>角色管理</h2>
      <button class="btn-primary" style="width:auto;padding:7px 18px" @click="startCreate">+ 新建角色</button>
    </div>

    <!-- Character Form Modal -->
    <div v-if="showCharForm" class="modal-overlay" @click.self="showCharForm = false">
      <div class="modal modal-wide">
        <h3>{{ editingChar ? '编辑角色' : '新建角色' }}</h3>
        <div class="char-form-grid">
          <div class="form-group"><label>姓名</label><input v-model="charForm.name" placeholder="角色姓名" required /></div>
          <div class="form-group"><label>性别</label><input v-model="charForm.gender" placeholder="男/女/其他" /></div>
          <div class="form-group"><label>年龄</label><input v-model="charForm.age" placeholder="例如：25岁" /></div>
          <div class="form-group"><label>状态</label><input v-model="charForm.status" placeholder="例如：存活/失踪" /></div>
          <div class="form-group full"><label>外貌</label><textarea v-model="charForm.appearance" placeholder="外貌描述" rows="3"></textarea></div>
          <div class="form-group full"><label>性格</label><textarea v-model="charForm.personality" placeholder="性格特点" rows="3"></textarea></div>
          <div class="form-group full"><label>能力/技能</label><textarea v-model="charForm.abilities" placeholder="角色的能力和技能" rows="3"></textarea></div>
          <div class="form-group full"><label>背景故事</label><textarea v-model="charForm.background" placeholder="角色的背景故事" rows="4"></textarea></div>
          <div class="form-group full"><label>经典语录</label><textarea v-model="charForm.quotes" placeholder="角色的经典台词" rows="2"></textarea></div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showCharForm = false">取消</button>
          <button class="btn-primary" style="width:auto;padding:8px 24px" @click="saveChar">保存</button>
        </div>
      </div>
    </div>

    <!-- Character Cards -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button v-if="characters.length > 0" class="btn-sm btn-danger" @click="deleteAllCharacters">
        清空所有角色
      </button>
    </div>
    <div class="char-grid">
      <div v-for="char in characters" :key="char.id" class="char-card">
        <div class="char-header">
          <div class="char-avatar">{{ char.name[0] }}</div>
          <div>
            <h3>{{ char.name }}</h3>
            <span class="char-meta">{{ char.gender }} {{ char.age ? '/ ' + char.age : '' }}</span>
          </div>
          <div class="char-actions">
            <button class="btn-sm" @click="startEdit(char)">编辑</button>
            <button class="btn-sm btn-danger" @click="deleteChar(char.id)">删除</button>
          </div>
        </div>
        <div v-if="char.personality" class="char-field">
          <span class="field-label">性格</span>
          <span>{{ char.personality }}</span>
        </div>
        <div v-if="char.abilities" class="char-field">
          <span class="field-label">能力</span>
          <span>{{ char.abilities }}</span>
        </div>
        <div v-if="char.status" class="char-field">
          <span class="field-label">状态</span>
          <span>{{ char.status }}</span>
        </div>
      </div>
      <div v-if="!characters.length" class="empty-state">暂无角色，点击上方按钮创建</div>
    </div>

    <!-- Relationships -->
    <div class="rel-section">
      <div class="section-header">
        <h3>角色关系</h3>
        <div style="display:flex;gap:8px">
          <button v-if="relationships.length > 0" class="btn-sm btn-danger" @click="deleteAllRelationships">
            清空所有关系
          </button>
          <button class="btn-sm" @click="startAddRel">+ 添加关系</button>
        </div>
      </div>

      <div v-if="showRelForm" class="rel-form">
        <select v-model="relForm.from_char_id">
          <option value="">选择角色A</option>
          <option v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <span>→</span>
        <select v-model="relForm.to_char_id">
          <option value="">选择角色B</option>
          <option v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <select v-model="relForm.relation_type">
          <option value="">关系类型</option>
          <option v-for="t in RELATION_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
        <input v-model.number="relForm.intimacy" type="range" min="0" max="100" style="width:80px" />
        <span class="intimacy-val">{{ relForm.intimacy }}</span>
        <button class="btn-sm" @click="saveRel">保存</button>
        <button class="btn-sm" @click="cancelRelEdit">取消</button>
      </div>

      <div class="rel-list">
        <div v-for="rel in relationships" :key="rel.id" class="rel-item">
          <span class="rel-from">{{ getCharName(rel.from_char_id) }}</span>
          <span class="rel-arrow">→</span>
          <span class="rel-type">{{ rel.relation_type }}</span>
          <span class="rel-arrow">→</span>
          <span class="rel-to">{{ getCharName(rel.to_char_id) }}</span>
          <span class="rel-intimacy">亲密度 {{ rel.intimacy }}</span>
          <button class="btn-sm" @click="startEditRel(rel)">编辑</button>
          <button class="btn-sm btn-danger" @click="deleteRel(rel.id)">删除</button>
        </div>
        <p v-if="!relationships.length" class="empty-text">暂无角色关系</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.character-view { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
.view-header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
.view-header h2 { flex: 1; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
.btn-back { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px; }
.btn-back:hover { color: var(--text); }
.btn-primary { border: none; border-radius: 6px; background: var(--text); color: var(--bg-card); cursor: pointer; font-size: 14px; }
.btn-secondary { padding: 8px 16px; border: 1px solid var(--border); border-radius: 6px; background: transparent; cursor: pointer; font-size: 14px; }
.btn-sm { padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px; background: transparent; cursor: pointer; font-size: 12px; color: var(--text-secondary); }
.btn-sm:hover { border-color: var(--border-hover); color: var(--text); }
.btn-danger:hover { border-color: var(--danger); color: var(--danger); }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 480px; padding: 28px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.08); }
.modal-wide { width: 600px; max-height: 80vh; overflow-y: auto; }
.modal h3 { font-size: 17px; font-weight: 600; margin-bottom: 20px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.char-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.char-form-grid .full { grid-column: 1 / -1; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-size: 12px; font-weight: 500; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.form-group input, .form-group textarea { padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; font-family: inherit; }
.form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--text); }
.char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-bottom: 40px; }
.char-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
.char-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.char-avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 16px; flex-shrink: 0; }
.char-header h3 { font-size: 15px; font-weight: 600; }
.char-meta { font-size: 12px; color: var(--text-secondary); }
.char-actions { margin-left: auto; display: flex; gap: 4px; }
.char-field { margin-bottom: 8px; font-size: 13px; line-height: 1.5; }
.field-label { font-size: 11px; font-weight: 500; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px; margin-right: 8px; }
.empty-state { grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-secondary); font-size: 14px; }
.rel-section { margin-top: 8px; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.section-header h3 { font-size: 16px; font-weight: 600; }
.rel-form { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.rel-form select, .rel-form input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--bg-card); }
.rel-form select:focus, .rel-form input:focus { outline: none; border-color: var(--text); }
.intimacy-val { font-size: 12px; color: var(--text-secondary); min-width: 24px; }
.rel-list { display: flex; flex-direction: column; gap: 6px; }
.rel-item { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; font-size: 14px; }
.rel-from, .rel-to { font-weight: 500; }
.rel-arrow { color: var(--text-secondary); font-size: 12px; }
.rel-type { padding: 2px 8px; background: var(--bg-hover); border-radius: 4px; font-size: 12px; }
.rel-intimacy { margin-left: auto; font-size: 12px; color: var(--text-secondary); }
.empty-text { color: var(--text-secondary); font-size: 13px; }
</style>
