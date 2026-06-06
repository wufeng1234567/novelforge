<script setup>
import { useAuthStore } from '../stores/auth'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <header class="app-header">
    <div class="header-left" @click="router.push('/')">
      <span class="logo">NovelForge</span>
    </div>
    <div class="header-right">
      <span class="user-name">{{ auth.user?.nickname || auth.user?.username }}</span>
      <span class="user-id">@{{ auth.user?.username }}</span>
      <button class="btn-logout" @click="handleLogout">退出</button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  z-index: 100;
}
.header-left { cursor: pointer; }
.logo {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.5px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.user-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.user-id {
  font-size: 12px;
  color: var(--text-secondary);
}
.btn-logout {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}
.btn-logout:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
