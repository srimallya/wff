const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')

export const API_BASE = import.meta.env.VITE_API_BASE || `${basePath}/api`

export function getCsrfToken() {
  return localStorage.getItem('wff_csrfToken') || ''
}

export function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = getCsrfToken()
    if (token && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token)
    }
  }
  return fetch(url, {
    ...options,
    credentials: options.credentials || 'include',
    headers,
  })
}
