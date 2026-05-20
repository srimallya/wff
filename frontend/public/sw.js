const CACHE_NAME = 'wff-v2'
const SW_BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '')
const withBase = (path) => `${SW_BASE}${path}`
const normalizeAppUrl = (url) => {
  if (!url) return withBase('/profile')
  if (/^https?:\/\//.test(url)) return url
  if (SW_BASE && url.startsWith(`${SW_BASE}/`)) return url
  if (url.startsWith('/')) return withBase(url)
  return withBase(`/${url}`)
}
const APP_SHELL = [withBase('/'), withBase('/manifest.webmanifest'), withBase('/icon.svg')]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url)

  if (requestUrl.pathname.startsWith(withBase('/api/')) || requestUrl.pathname.startsWith('/api/')) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(withBase('/')))
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((response) => {
        if (event.request.method !== 'GET' || !response || response.status !== 200) {
          return response
        }

        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        return response
      })
    )
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (error) {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'World Foresight Forum'
  const options = {
    body: payload.body || 'New message received',
    icon: withBase('/icon.svg'),
    badge: withBase('/icon.svg'),
    data: {
      url: normalizeAppUrl(payload.url),
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(normalizeAppUrl(event.notification.data?.url), self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
