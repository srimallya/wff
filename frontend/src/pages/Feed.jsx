import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import FeedFilters from '../components/FeedFilters'
import EssayCard from '../components/EssayCard'
import { IconButton } from '../components/Icons'

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
          <IconButton onClick={handleFeedTab} icon="forum" label="Forum" className="icon-button-primary" />
          {user.canPost && (
            <IconButton onClick={() => navigate('/compose')} icon="edit" label="Write" />
          )}
          <IconButton onClick={() => navigate('/profile')} icon="profile" label="Profile" />
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
              <IconButton
                type="button"
                onClick={handleClearSearch}
                icon="close"
                label="Clear"
                className="!h-9 !w-9"
              />
            )}
            <IconButton
              type="submit"
              icon="search"
              label="Search"
              className="icon-button-primary !h-9 !w-9"
            />
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
                <IconButton onClick={() => navigate('/compose')} icon="edit" label="Write the first post" className="icon-button-primary mt-4" />
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
