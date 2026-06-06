import client from './client'

export const freeModeApi = {
  start() {
    return client.post('/free-deepseek/start')
  },
  getQr(sessionId) {
    return client.get(`/free-deepseek/qr/${sessionId}`)
  },
  checkStatus(sessionId) {
    return client.get(`/free-deepseek/status/${sessionId}`)
  },
  inject(sessionId, data) {
    return client.post(`/free-deepseek/inject/${sessionId}`, data)
  },
  send(sessionId) {
    return client.post(`/free-deepseek/send/${sessionId}`)
  },
  getResponse(sessionId) {
    return client.get(`/free-deepseek/response/${sessionId}`)
  },
  stop(sessionId) {
    return client.post(`/free-deepseek/stop/${sessionId}`)
  },
  cookieStatus() {
    return client.get('/free-deepseek/cookie-status')
  },
  syncCookie(cookie) {
    return client.post('/free-deepseek/sync-cookie', { cookie })
  },
  extensionStatus() {
    return client.get('/free-deepseek/extension-status')
  },
  extensionHeartbeat() {
    return client.post('/free-deepseek/extension-heartbeat')
  },
}
