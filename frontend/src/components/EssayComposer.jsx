import { useState } from 'react'
import TimeSlider from './TimeSlider'
import { COUNTRIES } from '../countries'
import { IconButton } from './Icons'

export default function EssayComposer({ onSubmit, isSubmitting }) {
  const [lookAheadMonths, setLookAheadMonths] = useState(360)
  const [countryCode, setCountryCode] = useState('GLOBAL')
  const [content, setContent] = useState('')

  const len = content.trim().length
  const isValid = len >= 50 && len <= 2000 && lookAheadMonths > 0

  const handleSubmit = () => {
    if (!isValid) return
    onSubmit({
      look_ahead_months: lookAheadMonths,
      country_code: countryCode,
      country: COUNTRIES.find((country) => country.code === countryCode)?.name || 'Global',
      content: content.trim(),
    })
  }

  return (
    <div className="space-y-6">
      <div className="swiss-panel">
        <h3 className="mb-6 text-base font-medium">Which future are you writing for?</h3>
        <TimeSlider value={lookAheadMonths} onChange={setLookAheadMonths} />
      </div>

      <div className="swiss-panel space-y-2">
        <label className="block text-sm text-gray-400" htmlFor="country">Country</label>
        <select
          id="country"
          value={countryCode}
          onChange={(event) => setCountryCode(event.target.value)}
          className="w-full border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary"
        >
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>{country.name}</option>
          ))}
        </select>
        <p className="text-xs text-gray-500">Choose Global when the post is not tied to one country.</p>
      </div>

      <div className="swiss-panel space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Your foresight post</h3>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={2000}
          placeholder="Write a public foresight note about policy, governance, climate, technology, education, cities, culture, work, or everyday life..."
          className="w-full h-64 resize-none border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary"
        />

        <div className="flex items-center justify-between">
          <span className={`text-sm ${
            len < 50 || len > 2000 ? 'text-red-500' : 'text-gray-400'
          }`}>
            {len < 50
              ? `Write ${50 - len} more characters`
              : len > 2000
              ? `2000 character limit exceeded`
              : `${len} / 2000 characters`}
          </span>

          <IconButton
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            icon="send"
            label={isSubmitting ? 'Posting' : 'Post'}
            className={`${
              isValid && !isSubmitting
                ? 'icon-button-primary'
                : ''
            }`}
          />
        </div>
      </div>
    </div>
  )
}
