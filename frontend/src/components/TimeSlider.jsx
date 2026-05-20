import { useState, useMemo } from 'react'

export default function TimeSlider({ value, onChange }) {
  const label = useMemo(() => {
    const years = Math.floor(value / 12)
    const months = value % 12
    if (years === 0 && months === 0) {
      return 'Now'
    }
    if (years === 0) return `${months} months ahead`
    if (months === 0) return `${years} years ahead`
    return `${years} years ${months} months ahead`
  }, [value])

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">Now</span>
        <span className="text-primary font-medium text-base">{label}</span>
        <span className="text-gray-400">Future</span>
      </div>
      <div className="relative h-8">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-dark-border" />
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${(value / 1200) * 100}%` }}
        />
        <input
          type="range"
          min={0}
          max={1200}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="absolute inset-x-0 top-0 h-8 w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  )
}
