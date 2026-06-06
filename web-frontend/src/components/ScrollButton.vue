<template>
  <transition name="fade">
    <div v-if="visible" class="scroll-button-container" :style="{ bottom: bottom + 'px', right: right + 'px' }">
      <button class="scroll-btn-inner" :style="{ width: size + 'px', height: size + 'px', minWidth: size + 'px' }" @click="handleClick">
        <svg v-if="scrollDirection === 'down'" :width="size * 0.45" :height="size * 0.45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <svg v-else :width="size * 0.45" :height="size * 0.45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
    </div>
  </transition>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'

const props = defineProps({
  bottom: {
    type: Number,
    default: 80
  },
  right: {
    type: Number,
    default: 20
  },
  size: {
    type: Number,
    default: 40
  },
  scrollContainer: {
    type: Object,
    default: null
  }
})

const visible = ref(false)
const scrollDirection = ref('down')
let lastScrollTop = 0
let hideTimer = null
let directionTimer = null

const getTarget = () => props.scrollContainer || document.documentElement

const handleScroll = () => {
  const target = getTarget()
  const scrollTop = props.scrollContainer ? target.scrollTop : document.documentElement.scrollTop

  visible.value = scrollTop > 50

  if (directionTimer) clearTimeout(directionTimer)
  directionTimer = setTimeout(() => {
    if (scrollTop > lastScrollTop) {
      scrollDirection.value = 'down'
    } else {
      scrollDirection.value = 'up'
    }
    lastScrollTop = scrollTop <= 0 ? 0 : scrollTop
  }, 80)

  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    visible.value = false
  }, 1000)
}

const handleClick = () => {
  const target = getTarget()
  if (scrollDirection.value === 'down') {
    if (props.scrollContainer) {
      target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
    }
  } else {
    if (props.scrollContainer) {
      target.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
}

onMounted(() => {
  const target = props.scrollContainer || window
  target.addEventListener('scroll', handleScroll)
  nextTick(() => handleScroll())
})

watch(() => props.scrollContainer, (newVal, oldVal) => {
  if (oldVal) oldVal.removeEventListener('scroll', handleScroll)
  if (newVal) {
    newVal.addEventListener('scroll', handleScroll)
    nextTick(() => handleScroll())
  }
})

onBeforeUnmount(() => {
  const target = props.scrollContainer || window
  target.removeEventListener('scroll', handleScroll)
  if (hideTimer) clearTimeout(hideTimer)
  if (directionTimer) clearTimeout(directionTimer)
})
</script>

<style scoped>
.scroll-button-container {
  position: absolute;
  z-index: 10;
}

.scroll-btn-inner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: #000;
}

.scroll-btn-inner:hover {
  background: #f3f4f6;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  transform: translateY(-2px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
