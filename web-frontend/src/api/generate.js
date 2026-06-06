import axios from 'axios'

function getAuthHeaders() {
  const token = localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * SSE streaming generation - returns an EventSource-like readable stream
 */
export async function generateStream(params, onChunk, onDone, onError) {
  try {
    const response = await fetch('/api/v1/generate/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(params)
    })

    if (!response.ok) {
      if (response.status === 429) {
        onError?.('DeepSeek API 请求过于频繁（429），请等待 60 秒后再试')
        return
      }
      const err = await response.json().catch(() => ({ detail: 'Request failed' }))
      onError?.(err.detail || 'Request failed')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          onDone?.()
          return
        }
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) {
            onError?.(parsed.error)
            return
          }
          if (parsed.content) {
            onChunk(parsed.content)
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
    onDone?.()
  } catch (err) {
    onError?.(err.message)
  }
}

export const generateApi = {
  outline(params) {
    return axios.post('/api/v1/generate/outline', params, {
      headers: getAuthHeaders()
    })
  },
  rewrite(params) {
    return axios.post('/api/v1/generate/rewrite', params, {
      headers: getAuthHeaders()
    })
  },
  suggestions(params) {
    return axios.post('/api/v1/generate/suggestions', params, {
      headers: getAuthHeaders()
    })
  }
}
