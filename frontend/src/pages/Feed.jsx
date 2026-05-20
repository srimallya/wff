import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import FeedFilters from '../components/FeedFilters'
import EssayCard from '../components/EssayCard'

export default function Feed() {
  const navigate = useNavigate()
  const {
    user, fetchEssays, essays, feedFilter,
    searchQuery, searchResults, isSearching, searchError, searchEssays, clearSearch,
    resetFeedView
  } = useStore()
  const [loading, setLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    setLoading(true)
    fetchEssays().finally(() => setLoading(false))
  }, [feedFilter])

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

  const handleFeedTab = () => {
    setInputValue('')
    resetFeedView()
    navigate('/feed')
  }

  const displayEssays = searchQuery ? searchResults : essays
  const displayLoading = searchQuery ? isSearching : loading && displayEssays.length === 0
  const displayEmptyText = searchQuery
    ? 'No results found'
    : (feedFilter.active ? 'No posts for this year yet' : 'No foresight posts yet')

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 bg-dark-bg/95 backdrop-blur border-b border-dark-border p-4 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button onClick={handleFeedTab} className="text-primary font-medium text-sm">Forum</button>
          {user.canPost && (
            <button onClick={() => navigate('/compose')} className="text-gray-400 hover:text-white text-sm">Write</button>
          )}
          <button onClick={() => navigate('/profile')} className="text-gray-400 hover:text-white text-sm">Profile</button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <form onSubmit={handleSearchSubmit} className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search foresight posts..."
            className="w-full pl-4 pr-24 py-3 bg-dark-card border border-dark-border rounded-xl focus:outline-none focus:border-primary text-base"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              className="px-4 py-1.5 bg-primary hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors"
            >
              Search
            </button>
          </div>
        </form>

        {searchQuery && (
          <div className="text-sm text-gray-400">
            {searchResults.length} results for "{searchQuery}"
          </div>
        )}

        {searchError && (
          <div className="text-sm text-red-500 bg-red-500/10 p-3 rounded-lg">
            {searchError}
          </div>
        )}

        {!searchQuery && <FeedFilters />}

        <div className="space-y-4">
          {displayLoading ? (
            <div className="text-center py-12 text-gray-500">Loading...</div>
          ) : displayEssays.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>{displayEmptyText}</p>
              {user.canPost && !searchQuery && (
                <button onClick={() => navigate('/compose')} className="mt-4 text-primary hover:underline">
                  Write the first post
                </button>
              )}
            </div>
          ) : (
            displayEssays.map((essay) => <EssayCard key={essay.id} essay={essay} />)
          )}
        </div>
      </main>
    </div>
  )
}
