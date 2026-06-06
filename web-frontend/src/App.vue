<script setup>
import { useAuthStore } from './stores/auth'
import AppHeader from './components/AppHeader.vue'

const auth = useAuthStore()
</script>

<template>
  <div class="app">
    <AppHeader v-if="auth.isAuthenticated" />
    <main :class="{ 'with-header': auth.isAuthenticated }">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.with-header {
  flex: 1;
  min-height: 0;
  padding-top: 56px;
  position: relative;
}
</style>
