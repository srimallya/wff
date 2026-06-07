import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { Icon } from '../components/Icons'
import BottomNav from '../components/BottomNav'

function relativeTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.max(1, Math.round(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

function archiveLabel(hours) {
  if (!hours || hours <= 1) return 'Now'
  if (hours < 48) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 24) return `${months}mo`
  const years = Math.round(days / 365)
  return `${years}y`
}

function NowHistogram({ buckets, value, maxHours, onChange }) {
  const archiveMax = Math.max(1, Math.round(maxHours || 168))
  const selectedHours = value ? Math.max(1, Math.min(value, archiveMax)) : 1
  const rawValue = archiveMax - selectedHours + 1
  const maxCount = Math.max(...(buckets || []).map((bucket) => bucket.count || 0), 0)
  const areaPath = useMemo(() => {
    const items = buckets?.length ? buckets : Array.from({ length: 28 }, () => ({ count: 0 }))
    const points = items.map((bucket, index) => {
      const normalized = maxCount > 0 ? (bucket.count || 0) / maxCount : 0
      return {
        x: (index / Math.max(items.length - 1, 1)) * 100,
        y: 28 - normalized * 26,
      }
    })
    return `M 0 28 L ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')} L 100 28 Z`
  }, [buckets, maxCount])

  return (
    <div className="space-y-1">
      <div className="px-4">
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="block h-7 w-full" aria-hidden="true">
          {maxCount > 0 && <path d={areaPath} fill="rgba(156,163,175,0.72)" />}
        </svg>
      </div>
      <div className="px-4">
        <div className="relative h-8">
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-dark-border" />
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `${archiveMax <= 1 ? 100 : ((rawValue - 1) / (archiveMax - 1)) * 100}%` }}
          />
          <input
            type="range"
            min={1}
            max={archiveMax}
            value={rawValue}
            onChange={(event) => onChange(archiveMax - parseInt(event.target.value, 10) + 1)}
            className="absolute inset-x-0 top-0 h-8 w-full cursor-pointer opacity-0"
          />
        </div>
      </div>
      <div className="flex justify-between px-4 text-xs text-gray-500">
        <span>{archiveLabel(archiveMax)}</span>
        <span>Now</span>
      </div>
    </div>
  )
}

function NowStoryCard({ story }) {
  const { user, voteNowStory } = useStore()
  const [userVote, setUserVote] = useState(story.user_vote || null)
  const [votes, setVotes] = useState({
    score: story.score || 0,
    upvotes: story.upvotes || 0,
    downvotes: story.downvotes || 0,
  })

  useEffect(() => {
    setUserVote(story.user_vote || null)
    setVotes({
      score: story.score || 0,
      upvotes: story.upvotes || 0,
      downvotes: story.downvotes || 0,
    })
  }, [story.id, story.user_vote, story.score, story.upvotes, story.downvotes])

  const handleVote = async (value) => {
    if (!user.username) return
    const nextValue = userVote === value ? 0 : value
    const result = await voteNowStory(story.id, nextValue)
    if (result && !result.error) {
      setUserVote(result.user_vote)
      setVotes({ score: result.score, upvotes: result.upvotes, downvotes: result.downvotes })
    }
  }

  const openStory = () => {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
    window.location.href = `${basePath}/browser?url=${encodeURIComponent(story.url)}`
  }

  return (
    <article className="now-story">
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => handleVote(1)}
            disabled={!user.username}
            className={`text-lg font-bold transition-colors ${userVote === 1 ? 'text-primary' : 'text-gray-500 hover:text-gray-300'} disabled:opacity-30`}
            aria-label="Upvote story"
          >
            ▲
          </button>
          <span className={`text-sm font-semibold ${userVote === 1 ? 'text-primary' : userVote === -1 ? 'text-blue-400' : 'text-gray-300'}`}>
            {votes.score}
          </span>
          <button
            type="button"
            onClick={() => handleVote(-1)}
            disabled={!user.username}
            className={`text-lg font-bold transition-colors ${userVote === -1 ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'} disabled:opacity-30`}
            aria-label="Downvote story"
          >
            ▼
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
            <div className="min-w-0">
              <span className="text-primary font-medium">{story.source_name}</span>
              <span className="mx-2">•</span>
              <span>{story.region || 'Global'}</span>
            </div>
            <span className="shrink-0">{relativeTime(story.published_at || story.fetched_at)}</span>
          </div>
          <div className="space-y-2">
            <h2 className="now-story-title">{story.title}</h2>
            <p className="now-story-summary">{story.summary}</p>
          </div>
          <div className="flex items-center justify-between gap-4 pt-1 text-xs text-gray-600">
            <button type="button" onClick={openStory} className="swiss-action">
              Open
            </button>
            <span>{votes.upvotes} ▲ {votes.downvotes} ▼</span>
          </div>
        </div>
      </div>
    </article>
  )
}

export default function Now() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    fetchNowStories, nowStories, nowTotal, nowFacets, nowFilter,
    nowLoading, nowError, setNowSearch, setNowRegion, setNowHoursBack, clearNowSearch,
  } = useStore()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [inputValue, setInputValue] = useState(nowFilter.query || '')

  useEffect(() => {
    fetchNowStories()
  }, [fetchNowStories])

  useEffect(() => {
    if (searchParams.get('story')) setFiltersOpen(false)
  }, [searchParams])

  const handleSubmit = (event) => {
    event.preventDefault()
    setNowSearch(inputValue.trim())
  }

  const handleClear = () => {
    setInputValue('')
    clearNowSearch()
  }

  const handleClose = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/feed')
  }

  const featured = nowStories[0]
  const rest = nowStories.slice(1)
  const archiveMaxHours = nowFacets.archive?.max_hours || 168
  const hasNowFilters = Boolean(nowFilter.query || nowFilter.regionCode || nowFilter.hoursBack)

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <p className="app-kicker">World Foresight Forum</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <h1 className="app-title">Now</h1>
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                className="text-primary"
                aria-label="Search Now"
                title="Search Now"
                aria-expanded={filtersOpen}
                aria-controls="now-discovery-controls"
              >
                <Icon name="search" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="text-gray-400 hover:text-primary transition-colors"
                aria-label="Back to Forum"
                title="Back to Forum"
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6">
        <section
          id="now-discovery-controls"
          className={`feed-discovery-panel ${filtersOpen ? 'feed-discovery-panel-open now-discovery-panel-open' : ''}`}
          aria-hidden={!filtersOpen}
        >
          <div className="feed-discovery-panel-inner space-y-7 pb-7">
            <form onSubmit={handleSubmit} className="relative">
              <input
                type="text"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder="Search current stories..."
                className="w-full border-0 border-b px-0 py-3 pr-20 text-sm focus:outline-none focus:border-primary"
                tabIndex={filtersOpen ? 0 : -1}
              />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-4">
                {hasNowFilters && (
                  <button type="button" onClick={handleClear} className="swiss-line-button" tabIndex={filtersOpen ? 0 : -1}>
                    Clear
                  </button>
                )}
                <button type="submit" className="text-primary" aria-label="Search" tabIndex={filtersOpen ? 0 : -1}>
                  <Icon name="search" className="h-5 w-5" />
                </button>
              </div>
            </form>

            <div className="swiss-panel no-top-divider space-y-5">
              <div className="flex items-center justify-end">
                <select
                  value={nowFilter.regionCode || ''}
                  onChange={(event) => setNowRegion(event.target.value)}
                  className="w-full border-0 border-b px-0 py-2 text-sm focus:outline-none focus:border-primary"
                  tabIndex={filtersOpen ? 0 : -1}
                >
                  <option value="">All regions</option>
                  {(nowFacets.regions || []).map((region) => (
                    <option key={region.region_code} value={region.region_code}>
                      {region.region} ({region.count})
                    </option>
                  ))}
                </select>
              </div>
              <NowHistogram
                buckets={nowFacets.histogram || []}
                value={nowFilter.hoursBack}
                maxHours={archiveMaxHours}
                onChange={setNowHoursBack}
              />
            </div>

            {hasNowFilters && (
              <div className="text-sm text-gray-400">
                {nowTotal} stories
                {nowFilter.query ? ` for "${nowFilter.query}"` : ''}
                {nowFilter.hoursBack ? ` from the last ${archiveLabel(nowFilter.hoursBack)}` : ''}
              </div>
            )}
            {nowError && <div className="border-l border-primary pl-3 text-sm text-red-500">{nowError}</div>}
          </div>
        </section>

        {!filtersOpen && hasNowFilters && (
          <div className="feed-search-summary mt-7">
            <span>{nowTotal} filtered stories</span>
            <div className="flex items-center gap-4">
              <button type="button" onClick={handleClear} className="swiss-line-button">Clear</button>
              <button type="button" onClick={() => setFiltersOpen(true)} className="swiss-action text-sm">Search</button>
            </div>
          </div>
        )}

        <div className={`${filtersOpen || hasNowFilters ? 'mt-7' : ''}`}>
          {nowLoading && nowStories.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">Loading...</div>
          ) : nowStories.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">No current stories yet</div>
          ) : (
            <div>
              <NowStoryCard story={featured} />
              <div className="space-y-0">
                {rest.map((story) => <NowStoryCard key={story.id} story={story} />)}
              </div>
            </div>
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
