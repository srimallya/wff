import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import FeedFilters from '../components/FeedFilters'
import EssayCard from '../components/EssayCard'
import { IconButton } from '../components/Icons'
import BottomNav from '../components/BottomNav'

export default function Feed() {
  const navigate = useNavigate()
  const {
    user, fetchEssays, essays, feedFilter,
    searchQuery, searchResults, isSearching, searchError, searchEssays, clearSearch,
  } = useStore()
  const [loading, setLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    if (searchQuery) return
    setLoading(true)
    fetchEssays().finally(() => setLoading(false))
  }, [feedFilter, searchQuery, fetchEssays])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (!inputValue.trim()) {
      clearSearch()
      return
    }
    searchEssays(inputValue.trim())
  }

  const handleClearSearch = () => {
    setInputValue('')
    clearSearch()
  }

  const displayEssays = searchQuery ? searchResults : essays
  const displayLoading = searchQuery ? isSearching : loading && displayEssays.length === 0
  const displayEmptyText = searchQuery
    ? 'No results found'
    : (feedFilter.active ? 'No posts for this year yet' : 'No foresight posts yet')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <p className="app-kicker">World Foresight Forum</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <h1 className="app-title">Forum</h1>
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              className="swiss-action text-sm"
              aria-expanded={filtersOpen}
              aria-controls="feed-discovery-controls"
            >
              Search
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6">
        <section
          id="feed-discovery-controls"
          className={`feed-discovery-panel ${filtersOpen ? 'feed-discovery-panel-open' : ''}`}
          aria-hidden={!filtersOpen}
        >
          <div className="feed-discovery-panel-inner space-y-7 pb-7">
            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Search foresight posts..."
                className="w-full border-0 border-b px-0 py-3 pr-20 text-sm focus:outline-none focus:border-primary"
                tabIndex={filtersOpen ? 0 : -1}
              />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-4">
                {searchQuery && (
                  <IconButton
                    type="button"
                    onClick={handleClearSearch}
                    icon="close"
                    label="Clear"
                    className="swiss-line-button"
                    tabIndex={filtersOpen ? 0 : -1}
                  />
                )}
                <IconButton
                  type="submit"
                  icon="search"
                  label="Search"
                  className="icon-button-primary"
                  tabIndex={filtersOpen ? 0 : -1}
                />
              </div>
            </form>

            {searchQuery && (
              <div className="text-sm text-gray-400">
                {searchResults.length} results for "{searchQuery}"
              </div>
            )}

            {searchError && (
              <div className="border-l border-primary pl-3 text-sm text-red-500">
                {searchError}
              </div>
            )}

            <FeedFilters />
          </div>
        </section>

        {!filtersOpen && searchQuery && (
          <div className="feed-search-summary mt-7">
            <span>{searchResults.length} results for "{searchQuery}"</span>
            <div className="flex items-center gap-4">
              <IconButton
                type="button"
                onClick={handleClearSearch}
                icon="close"
                label="Clear"
                className="swiss-line-button"
              />
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="swiss-action text-sm"
              >
                Search
              </button>
            </div>
          </div>
        )}

        <div className={`${filtersOpen || searchQuery ? 'mt-7' : ''} space-y-4`}>
          {displayLoading ? (
            <div className="py-12 text-center text-sm text-gray-500">Loading...</div>
          ) : displayEssays.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">
              <p>{displayEmptyText}</p>
              {user.canPost && !searchQuery && (
                <IconButton onClick={() => navigate('/compose')} icon="edit" label="Write the first post" className="icon-button-primary mt-4" />
              )}
            </div>
          ) : (
            displayEssays.map((essay) => <EssayCard key={essay.id} essay={essay} />)
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
