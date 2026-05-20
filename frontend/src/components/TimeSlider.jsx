import { useState, useMemo } from 'react'

export default function TimeSlider({ value, onChange }) {
  const currentYear = new Date().getFullYear()

  const { label, calendarYear } = useMemo(() => {
    const years = Math.floor(value / 12)
    const months = value % 12
    let labelText = ''
    if (years === 0 && months === 0) {
      labelText = 'Now'
    } else if (years === 0) {
      labelText = `${months} months ahead`
    } else if (months === 0) {
      labelText = `${years} years ahead`
    } else {
      labelText = `${years} years ${months} months ahead`
    }
    return {
      label: labelText,
      calendarYear: currentYear + years + (months >= 6 ? 1 : 0),
    }
  }, [value])

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">Now</span>
        <span className="text-primary font-semibold text-lg">{label}</span>
        <span className="text-gray-400">Future</span>
      </div>
      <input
        type="range"
        min={0}
        max={1200}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-2 bg-dark-border rounded-lg appearance-none cursor-pointer accent-primary"
      />
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-dark-card p-4 rounded-lg border border-dark-border">
          <p className="text-xs text-gray-400 mb-1">Calendar year</p>
          <p className="text-2xl font-semibold text-primary">{calendarYear}</p>
        </div>
        <div className="bg-dark-card p-4 rounded-lg border border-dark-border">
          <p className="text-xs text-gray-400 mb-1">Time</p>
          <p className="text-2xl font-semibold text-primary">{label}</p>
        </div>
      </div>
    </div>
  )
}
