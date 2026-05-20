import { useStore } from '../store/zustandStore'
import { useEffect, useMemo } from 'react'
import { COUNTRIES } from '../countries'

export default function FeedFilters() {
  const {
    feedFilter, setFeedYear, clearFeedFilter, essaysTotal,
    feedYearCounts, fetchFeedYearCounts, feedTimelineEssays, essays, setFeedCountry
  } = useStore()
  const currentYear = new Date().getFullYear()

  const sliderValue = feedFilter.year ?? currentYear
  const displayLabel = feedFilter.active ? feedFilter.year : 'All years'
  const sliderPercent = ((sliderValue - currentYear) / 100) * 100

  useEffect(() => {
    fetchFeedYearCounts()
  }, [fetchFeedYearCounts])

  const { areaPath, hasPosts } = useMemo(() => {
    const fallback = Array.from({ length: 101 }, (_, index) => ({
      year: currentYear + index,
      count: 0,
    }))
    const counts = fallback.map((item) => ({ ...item }))
    const hasSummaryCounts = feedYearCounts.some((item) => item.count > 0)

    if (hasSummaryCounts) {
      feedYearCounts.forEach((item) => {
        const index = item.year - currentYear
        if (index >= 0 && index < counts.length) counts[index].count = item.count
      })
    } else {
      const sourceEssays = feedTimelineEssays.length > 0 ? feedTimelineEssays : essays
      sourceEssays.forEach((essay) => {
        const index = essay.target_calendar_year - currentYear
        if (index >= 0 && index < counts.length) counts[index].count += 1
      })
    }

    const maxCount = Math.max(...counts.map((item) => item.count), 0)
    const points = counts.map((item, index) => {
      const prev2 = counts[index - 2]?.count || 0
      const prev1 = counts[index - 1]?.count || 0
      const next1 = counts[index + 1]?.count || 0
      const next2 = counts[index + 2]?.count || 0
      const smoothed = (
        (prev2 * 0.08) +
        (prev1 * 0.22) +
        (item.count * 0.4) +
        (next1 * 0.22) +
        (next2 * 0.08)
      )
      const normalized = maxCount > 0 ? smoothed / maxCount : 0

      return {
        x: (index / 100) * 100,
        y: 28 - (normalized * 26),
      }
    })

    const path = points.length > 0
      ? `M 0 28 L ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')} L 100 28 Z`
      : ''

    return {
      areaPath: path,
      hasPosts: maxCount > 0,
    }
  }, [currentYear, feedYearCounts, feedTimelineEssays, essays])

  return (
    <div className="bg-dark-card p-4 rounded-xl border border-dark-border space-y-1.5">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Timeline:</span>
          <span className="text-primary font-semibold text-lg">{displayLabel}</span>
          <span className="text-xs text-gray-500 ml-2">{essaysTotal} posts</span>
          {feedFilter.active && (
            <button
              onClick={clearFeedFilter}
              className="text-xs text-primary hover:underline ml-2"
            >
              All years
            </button>
          )}
        </div>
        <select
          value={feedFilter.countryCode || ''}
          onChange={(event) => setFeedCountry(event.target.value)}
          className="w-full sm:w-56 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-white focus:outline-none focus:border-primary"
        >
          <option value="">All countries</option>
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>{country.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1 -mt-1">
        <div className="px-4">
          <svg
            viewBox="0 0 100 28"
            preserveAspectRatio="none"
            className="block h-7 w-full"
            aria-hidden="true"
          >
            {hasPosts && <path d={areaPath} fill="rgba(156,163,175,0.72)" />}
          </svg>
        </div>
        <div className="px-4">
          <div className="relative h-8">
            <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-lg bg-dark-border" />
            <div
              className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
              style={{ left: `${sliderPercent}%` }}
            />
            <input
              type="range"
              min={currentYear}
              max={currentYear + 100}
              value={sliderValue}
              onChange={(e) => setFeedYear(parseInt(e.target.value))}
              className="absolute inset-x-0 top-0 h-8 w-full cursor-pointer opacity-0"
            />
          </div>
        </div>
        <div className="flex justify-between px-4 text-xs text-gray-500">
          <span>{currentYear}</span>
          <span>{currentYear + 100}</span>
        </div>
      </div>
    </div>
  )
}
