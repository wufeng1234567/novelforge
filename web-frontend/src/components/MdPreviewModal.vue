<template>
  <div v-if="visible" class="md-modal-overlay" @click.self="$emit('close')">
    <div class="md-modal-dialog">
      <div class="md-modal-header">
        <span>{{ title }}</span>
        <button class="md-modal-close" @click="$emit('close')">&times;</button>
      </div>
      <div class="md-modal-body rendered-md" v-html="renderedContent"></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '详情' },
  content: { type: String, default: '' },
  isHtml: { type: Boolean, default: false }
})

defineEmits(['close'])

const renderedContent = computed(() => {
  if (!props.content) return ''
  if (props.isHtml) return props.content
  try {
    return DOMPurify.sanitize(marked.parse(props.content))
  } catch {
    return props.content
  }
})
</script>

<style scoped>
.md-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.md-modal-dialog {
  width: 90vw;
  max-width: 800px;
  max-height: 85vh;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.md-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border, #e5e7eb);
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #1f2937);
}
.md-modal-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-secondary, #737373);
  transition: color 0.15s;
}
.md-modal-close:hover { color: var(--text, #1f2937); }
.md-modal-body {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text, #1f2937);
}
</style>
