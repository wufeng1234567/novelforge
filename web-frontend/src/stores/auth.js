import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '../api/auth'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const accessToken = ref(localStorage.getItem('access_token') || '')
  const refreshToken = ref(localStorage.getItem('refresh_token') || '')

  const isAuthenticated = computed(() => !!accessToken.value)

  function setTokens(access, refresh) {
    accessToken.value = access
    refreshToken.value = refresh
    localStorage.setItem('access_token', access)
    localStorage.setItem('refresh_token', refresh)
  }

  async function register(email, username, password, nickname) {
    const { data } = await authApi.register(email, username, password, nickname)
    setTokens(data.access_token, data.refresh_token)
    await fetchUser()
  }

  async function login(account, password) {
    const { data } = await authApi.login(account, password)
    setTokens(data.access_token, data.refresh_token)
    await fetchUser()
  }

  async function fetchUser() {
    try {
      const { data } = await authApi.getMe()
      user.value = data
    } catch {
      logout()
    }
  }

  function logout() {
    user.value = null
    accessToken.value = ''
    refreshToken.value = ''
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  }

  // Auto-fetch user if token exists
  if (accessToken.value) {
    fetchUser()
  }

  return { user, isAuthenticated, register, login, fetchUser, logout }
})
