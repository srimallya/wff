import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { API_BASE, apiFetch } from '../api'
import { Icon } from '../components/Icons'
import BottomNav from '../components/BottomNav'
import RichText from '../components/RichText'
import { copyTextToClipboard, nowShareUrl } from '../shareLinks'

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

function parseTime(value) {
  const time = value ? new Date(value).getTime() : NaN
  return Number.isNaN(time) ? null : time
}

function NowHistogram({ buckets, timeStart, timeEnd, maxHours, onChange }) {
  const archiveMax = Math.max(1, Math.round(maxHours || 168))
  const items = buckets?.length ? buckets : Array.from({ length: 28 }, (_, index) => ({ index, count: 0 }))
  const selectedStart = parseTime(timeStart)
  const selectedEnd = parseTime(timeEnd)
  const selectedMidpoint = selectedStart && selectedEnd ? (selectedStart + selectedEnd) / 2 : null
  const selectedIndex = selectedMidpoint
    ? items.reduce((best, bucket, index) => {
        const start = parseTime(bucket.start)
        const end = parseTime(bucket.end)
        if (!start || !end) return best
        const distance = Math.abs(((start + end) / 2) - selectedMidpoint)
        return distance < best.distance ? { index, distance } : best
      }, { index: items.length - 1, distance: Number.POSITIVE_INFINITY }).index
    : items.length - 1
  const maxCount = Math.max(...(buckets || []).map((bucket) => bucket.count || 0), 0)
  const areaPath = useMemo(() => {
    const points = items.map((bucket, index) => {
      const normalized = maxCount > 0 ? (bucket.count || 0) / maxCount : 0
      return {
        x: (index / Math.max(items.length - 1, 1)) * 100,
        y: 28 - normalized * 26,
      }
    })
    return `M 0 28 L ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')} L 100 28 Z`
  }, [items, maxCount])

  const handleChange = (rawValue) => {
    const index = Math.max(0, Math.min(items.length - 1, parseInt(rawValue, 10)))
    const bucket = items[index]
    if (bucket?.start && bucket?.end) onChange(bucket.start, bucket.end)
  }

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
            style={{ left: `${items.length <= 1 ? 100 : (selectedIndex / (items.length - 1)) * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={Math.max(0, items.length - 1)}
            value={selectedIndex}
            onChange={(event) => handleChange(event.target.value)}
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

function NowStoryCard({ story, focused = false, onDiscuss }) {
  const { user, voteNowStory } = useStore()
  const [userVote, setUserVote] = useState(story.user_vote || null)
  const [votes, setVotes] = useState({
    score: story.score || 0,
    upvotes: story.upvotes || 0,
    downvotes: story.downvotes || 0,
  })
  const [copied, setCopied] = useState(false)

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

  const shareStory = async () => {
    const didCopy = await copyTextToClipboard(nowShareUrl(story.id))
    if (didCopy) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <article id={`now-story-${story.id}`} className={`now-story ${focused ? 'now-story-focused' : ''}`}>
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
            <div className="flex items-center gap-4">
              <button type="button" onClick={openStory} className="swiss-action">
                Open
              </button>
              <button type="button" onClick={shareStory} className="swiss-action">
                {copied ? 'Copied' : 'Share'}
              </button>
              {!focused && (
                <button type="button" onClick={() => onDiscuss?.(story.id)} className="swiss-action">
                  Discuss
                </button>
              )}
            </div>
            <span>{votes.upvotes} ▲ {votes.downvotes} ▼ · {story.comment_count || 0} comments</span>
          </div>
        </div>
      </div>
    </article>
  )
}

function NowComments({ story, user, comments, commentText, setCommentText, loading, error, submitting, onSubmit }) {
  return (
    <section className="space-y-4 border-t border-dark-border pt-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Comments</h2>
        <span className="text-sm text-gray-500">{comments.length}</span>
      </div>

      {user.canPost ? (
        <form onSubmit={onSubmit} className="space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <textarea
            value={commentText}
            onChange={(event) => setCommentText(event.target.value.slice(0, 2000))}
            placeholder={`Comment on "${story.title}"...`}
            rows={3}
            className="w-full resize-none border-0 border-b px-0 py-3 text-sm focus:border-primary focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">{commentText.length}/2000</span>
            <button type="submit" disabled={submitting || commentText.trim().length < 2} className="swiss-action disabled:opacity-30">
              {submitting ? 'Posting' : 'Post comment'}
            </button>
          </div>
        </form>
      ) : (
        <div className="border-t border-dark-border py-4 text-sm text-gray-500">
          Comments require a registered writing account.
        </div>
      )}

      {loading ? (
        <div className="py-5 text-center text-sm text-gray-500">Loading comments...</div>
      ) : comments.length === 0 ? (
        <div className="border-t border-dark-border py-5 text-center text-sm text-gray-500">No comments yet</div>
      ) : (
        <div className="space-y-0">
          {comments.map((comment) => (
            <div key={comment.id} className="border-t border-dark-border py-4">
              <div className="mb-2 text-xs text-gray-500">
                <span className="font-semibold text-primary">{comment.username}</span>
                <span className="mx-2">•</span>
                <span>{new Date(comment.created_at).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                <RichText text={comment.content} />
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function Now() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    user, fetchNowStories, nowStories, nowTotal, nowFacets, nowFilter,
    nowLoading, nowError, setNowSearch, setNowRegion, setNowTimeWindow, clearNowSearch,
  } = useStore()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [inputValue, setInputValue] = useState(nowFilter.query || '')
  const [focusedStory, setFocusedStory] = useState(null)
  const [focusedLoading, setFocusedLoading] = useState(false)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const selectedStoryId = searchParams.get('story')

  useEffect(() => {
    fetchNowStories()
  }, [fetchNowStories])

  useEffect(() => {
    if (searchParams.get('story')) setFiltersOpen(false)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    async function loadFocusedStory(storyId) {
      if (!storyId) {
        setFocusedStory(null)
        setComments([])
        setCommentText('')
        setCommentError('')
        return
      }
      setFocusedLoading(true)
      setCommentsLoading(true)
      setCommentError('')
      try {
        const userParam = user.id ? `?current_user_id=${encodeURIComponent(user.id)}` : ''
        const [storyRes, commentsRes] = await Promise.all([
          apiFetch(`${API_BASE}/now/${storyId}${userParam}`),
          apiFetch(`${API_BASE}/now/${storyId}/comments`),
        ])
        const storyData = await storyRes.json()
        const commentsData = await commentsRes.json()
        if (!storyRes.ok) throw new Error(storyData.error || 'Story could not be loaded')
        if (!commentsRes.ok) throw new Error(commentsData.error || 'Comments could not be loaded')
        if (!cancelled) {
          setFocusedStory(storyData)
          setComments(commentsData.comments || [])
        }
      } catch (error) {
        if (!cancelled) {
          setFocusedStory(null)
          setComments([])
          setCommentError(error.message || 'Story could not be loaded')
        }
      } finally {
        if (!cancelled) {
          setFocusedLoading(false)
          setCommentsLoading(false)
        }
      }
    }
    loadFocusedStory(selectedStoryId)
    return () => {
      cancelled = true
    }
  }, [selectedStoryId, user.id])

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

  const openDiscussion = (storyId) => {
    navigate(`/now?story=${encodeURIComponent(storyId)}`)
  }

  const clearFocusedStory = () => {
    navigate('/now')
  }

  const submitNowComment = async (event) => {
    event.preventDefault()
    if (!user.username || !focusedStory || !commentText.trim()) return
    setSubmittingComment(true)
    setCommentError('')
    try {
      const res = await apiFetch(`${API_BASE}/now/${focusedStory.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, content: commentText.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Comment failed')
      setComments((items) => [...items, data])
      setFocusedStory((current) => current ? { ...current, comment_count: (current.comment_count || 0) + 1 } : current)
      setCommentText('')
    } catch (error) {
      setCommentError(error.message || 'Comment failed')
    } finally {
      setSubmittingComment(false)
    }
  }

  const featured = nowStories[0]
  const rest = nowStories.slice(1)
  const archiveMaxHours = nowFacets.archive?.max_hours || 168
  const hasTimeWindow = Boolean(nowFilter.timeStart && nowFilter.timeEnd)
  const hasNowFilters = Boolean(nowFilter.query || nowFilter.regionCode || nowFilter.hoursBack || hasTimeWindow)

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
          className={`feed-discovery-panel ${filtersOpen && !selectedStoryId ? 'feed-discovery-panel-open now-discovery-panel-open' : ''}`}
          aria-hidden={!filtersOpen || Boolean(selectedStoryId)}
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
                timeStart={nowFilter.timeStart}
                timeEnd={nowFilter.timeEnd}
                maxHours={archiveMaxHours}
                onChange={setNowTimeWindow}
              />
            </div>

            {hasNowFilters && (
              <div className="text-sm text-gray-400">
                {nowTotal} stories
                {nowFilter.query ? ` for "${nowFilter.query}"` : ''}
                {nowFilter.hoursBack ? ` from the last ${archiveLabel(nowFilter.hoursBack)}` : ''}
                {hasTimeWindow ? ' in selected archive slice' : ''}
              </div>
            )}
            {nowError && <div className="border-l border-primary pl-3 text-sm text-red-500">{nowError}</div>}
          </div>
        </section>

        {!selectedStoryId && !filtersOpen && hasNowFilters && (
          <div className="feed-search-summary mt-7">
            <span>{nowTotal} filtered stories</span>
            <div className="flex items-center gap-4">
              <button type="button" onClick={handleClear} className="swiss-line-button">Clear</button>
              <button type="button" onClick={() => setFiltersOpen(true)} className="swiss-action text-sm">Search</button>
            </div>
          </div>
        )}

        <div className={`${filtersOpen || hasNowFilters || selectedStoryId ? 'mt-7' : ''}`}>
          {selectedStoryId ? (
            focusedLoading ? (
              <div className="py-12 text-center text-sm text-gray-500">Loading story...</div>
            ) : focusedStory ? (
              <div className="space-y-7">
                <button type="button" onClick={clearFocusedStory} className="swiss-action text-sm">
                  Back to Now
                </button>
                <NowStoryCard story={focusedStory} focused />
                <NowComments
                  story={focusedStory}
                  user={user}
                  comments={comments}
                  commentText={commentText}
                  setCommentText={setCommentText}
                  loading={commentsLoading}
                  error={commentError}
                  submitting={submittingComment}
                  onSubmit={submitNowComment}
                />
              </div>
            ) : (
              <div className="border-l border-primary pl-3 text-sm text-red-600">{commentError || 'Story could not be loaded'}</div>
            )
          ) : nowLoading && nowStories.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">Loading...</div>
          ) : nowStories.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">No current stories yet</div>
          ) : (
            <div>
              <NowStoryCard story={featured} onDiscuss={openDiscussion} />
              <div className="space-y-0">
                {rest.map((story) => <NowStoryCard key={story.id} story={story} onDiscuss={openDiscussion} />)}
              </div>
            </div>
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
