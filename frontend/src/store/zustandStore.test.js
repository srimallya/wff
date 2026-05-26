import { beforeEach, describe, expect, it, vi } from 'vitest'

const localStorageMock = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  }
}

function mockSearchResponse(essays = [], years = []) {
  return {
    ok: true,
    json: async () => ({
      essays,
      total: essays.length,
      facets: { countries: [], years },
      applied_filters: { query: 'climate', country_code: null, year: null },
    }),
  }
}

async function loadStore(seedLocalStorage = {}) {
  vi.resetModules()
  globalThis.localStorage = localStorageMock()
  Object.entries(seedLocalStorage).forEach(([key, value]) => globalThis.localStorage.setItem(key, value))
  globalThis.window = { location: { origin: 'http://localhost' } }
  globalThis.fetch = vi.fn()
  const module = await import('./zustandStore')
  return module.useStore
}

function lastFetchBody() {
  const call = globalThis.fetch.mock.calls.at(-1)
  return JSON.parse(call[1].body)
}

describe('WFF feed search store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('stores search query, results, and contextual year counts', async () => {
    const useStore = await loadStore()
    globalThis.fetch.mockResolvedValueOnce(mockSearchResponse(
      [{ id: 1, content: 'Climate futures' }],
      [{ year: 2030, count: 1 }],
    ))

    await useStore.getState().searchEssays('climate')

    const state = useStore.getState()
    expect(state.searchQuery).toBe('climate')
    expect(state.searchResults).toHaveLength(1)
    expect(state.searchYearCounts).toEqual([{ year: 2030, count: 1 }])
    expect(lastFetchBody()).toMatchObject({ query: 'climate' })
  })

  it('uses ranked recommendations as the default forum feed', async () => {
    const useStore = await loadStore()
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ essays: [{ id: 1 }], total: 1 }),
    })

    await useStore.getState().fetchEssays()

    expect(useStore.getState().feedRankingMode).toBe('ranked')
    expect(globalThis.fetch.mock.calls.at(-1)[0]).toContain('/recommendations/feed?')
    expect(globalThis.fetch.mock.calls.at(-1)[0]).toContain('limit=20')
  })

  it('remembers chronological preference and uses the existing feed endpoint', async () => {
    const useStore = await loadStore({ wff_feedRankingMode: 'chronological' })
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ essays: [{ id: 2 }], total: 1 }),
    })

    await useStore.getState().fetchEssays()

    expect(useStore.getState().feedRankingMode).toBe('chronological')
    expect(globalThis.fetch.mock.calls.at(-1)[0]).toContain('/essays?')
    expect(globalThis.fetch.mock.calls.at(-1)[0]).not.toContain('/recommendations/feed')
  })

  it('stores feed ranking preference when toggled', async () => {
    const useStore = await loadStore()
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ essays: [], total: 0 }),
    })

    useStore.getState().setFeedRankingMode('chronological')

    expect(useStore.getState().feedRankingMode).toBe('chronological')
    expect(globalThis.localStorage.getItem('wff_feedRankingMode')).toBe('chronological')
    expect(globalThis.fetch.mock.calls.at(-1)[0]).toContain('/essays?')
  })

  it('reruns active search on country change and clears selected year', async () => {
    const useStore = await loadStore()
    useStore.setState({
      searchQuery: 'climate',
      feedFilter: { countryCode: '', year: 2035, active: true },
    })
    globalThis.fetch.mockResolvedValueOnce(mockSearchResponse())

    useStore.getState().setFeedCountry('IND')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    expect(useStore.getState().feedFilter).toMatchObject({ countryCode: 'IND', year: null, active: false })
    expect(lastFetchBody()).toMatchObject({ query: 'climate', country_code: 'IND' })
    expect(lastFetchBody()).not.toHaveProperty('year')
  })

  it('reruns active search with selected year from the timeline slider', async () => {
    const useStore = await loadStore()
    useStore.setState({
      searchQuery: 'climate',
      feedFilter: { countryCode: 'IND', year: null, active: false },
    })
    globalThis.fetch.mockResolvedValueOnce(mockSearchResponse())

    useStore.getState().setFeedYear(2035)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    expect(lastFetchBody()).toMatchObject({ query: 'climate', country_code: 'IND', year: 2035 })
  })

  it('resetFeedView clears feed filters and all search facet state', async () => {
    const useStore = await loadStore()
    useStore.setState({
      feedFilter: { countryCode: 'IND', year: 2035, active: true },
      searchQuery: 'climate',
      searchResults: [{ id: 1 }],
      searchFacets: { countries: [{ country_code: 'IND', count: 1 }], years: [{ year: 2035, count: 1 }] },
      searchAppliedFilters: { query: 'climate', country_code: 'IND', year: 2035 },
      searchYearCounts: [{ year: 2035, count: 1 }],
      searchError: 'bad',
    })

    useStore.getState().resetFeedView()

    const state = useStore.getState()
    expect(state.feedFilter).toEqual({ year: null, active: false, countryCode: '' })
    expect(state.searchQuery).toBe('')
    expect(state.searchResults).toEqual([])
    expect(state.searchFacets).toEqual({ countries: [], years: [] })
    expect(state.searchAppliedFilters).toEqual({ query: '', country_code: null, year: null })
    expect(state.searchYearCounts).toEqual([])
    expect(state.searchError).toBeNull()
  })
})
