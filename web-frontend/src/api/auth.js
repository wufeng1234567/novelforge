import client from './client'

export const authApi = {
  register(email, username, password, nickname = '') {
    return client.post('/auth/register', { email, username, password, nickname })
  },
  login(account, password) {
    return client.post('/auth/login', { account, password })
  },
  refresh(refreshToken) {
    return client.post('/auth/refresh', { refresh_token: refreshToken })
  },
  getMe() {
    return client.get('/auth/me')
  }
}
