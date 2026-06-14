import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadShareLinks(origin = 'https://example.test') {
  vi.resetModules()
  globalThis.window = { location: { origin } }
  return import('./shareLinks')
}

describe('WFF share links', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('builds absolute Forum and Now share URLs', async () => {
    const { postShareUrl, nowShareUrl } = await loadShareLinks()

    expect(postShareUrl(42)).toBe('https://example.test/share/posts/42')
    expect(nowShareUrl(9)).toBe('https://example.test/share/now/9')
  })

  it('recognizes only same-origin WFF share paths', async () => {
    const { normalizeWffSharePath } = await loadShareLinks()

    expect(normalizeWffSharePath('https://example.test/share/posts/42')).toBe('/share/posts/42')
    expect(normalizeWffSharePath('https://example.test/share/now/9')).toBe('/share/now/9')
    expect(normalizeWffSharePath('https://other.test/share/posts/42')).toBeNull()
    expect(normalizeWffSharePath('https://example.test/posts/42')).toBeNull()
  })

  it('maps same-origin WFF share URLs to app paths', async () => {
    const { appPathForWffShare } = await loadShareLinks()

    expect(appPathForWffShare('https://example.test/share/posts/42')).toBe('/posts/42')
    expect(appPathForWffShare('https://example.test/share/now/9')).toBe('/now?story=9')
    expect(appPathForWffShare('https://example.test/now?story=9')).toBeNull()
  })
})
