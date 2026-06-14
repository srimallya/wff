import { API_BASE } from './api'

export function appBasePath() {
  return import.meta.env.BASE_URL.replace(/\/$/, '')
}

export function absoluteAppUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${appBasePath()}${normalizedPath}`
}

export function postShareUrl(postId) {
  return absoluteAppUrl(`/share/posts/${postId}`)
}

export function nowShareUrl(storyId) {
  return absoluteAppUrl(`/share/now/${storyId}`)
}

export function normalizeWffSharePath(rawUrl) {
  if (!rawUrl) return null
  let parsed
  try {
    parsed = new URL(rawUrl, window.location.origin)
  } catch (error) {
    return null
  }
  if (parsed.origin !== window.location.origin) return null
  const basePath = appBasePath()
  let path = parsed.pathname
  if (basePath && path.startsWith(`${basePath}/`)) {
    path = path.slice(basePath.length)
  }
  return /^\/share\/(?:posts|now)\/\d+$/.test(path) ? path : null
}

export function appPathForWffShare(rawUrl) {
  const sharePath = normalizeWffSharePath(rawUrl)
  if (!sharePath) return null
  const [, , kind, id] = sharePath.split('/')
  if (kind === 'posts') return `${appBasePath()}/posts/${id}`
  if (kind === 'now') return `${appBasePath()}/now?story=${id}`
  return null
}

export async function resolveWffShareUrl(rawUrl) {
  if (!normalizeWffSharePath(rawUrl)) return null
  const response = await fetch(`${API_BASE}/share/resolve?url=${encodeURIComponent(rawUrl)}`, {
    credentials: 'include',
  })
  if (!response.ok) return null
  return response.json()
}

export async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (error) {
      // Fall through to the textarea path for browsers that expose but block Clipboard API.
    }
  }
  if (typeof document === 'undefined' || !document.body) return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    const copied = document.execCommand('copy')
    if (!copied && typeof window.prompt === 'function') window.prompt('Copy this link', text)
    return copied
  } finally {
    document.body.removeChild(textarea)
  }
}
