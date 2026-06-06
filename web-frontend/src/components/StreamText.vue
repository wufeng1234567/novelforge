<script setup>
defineProps({
  text: { type: String, default: '' }
})
</script>

<template>
  <div class="stream-text">
    <span>{{ text }}</span>
    <span class="cursor">|</span>
  </div>
</template>

<style scoped>
.stream-text {
  padding: 12px;
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
}
.cursor {
  animation: blink 0.8s infinite;
  color: var(--text);
  font-weight: 300;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
