import { useEffect, useState } from 'react'
import { appPathForWffShare, normalizeWffSharePath, resolveWffShareUrl } from '../shareLinks'

const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi
const TRAILING_PUNCTUATION = /[),.!?:;]+$/

function appBrowserPath(rawUrl) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${basePath}/browser?url=${encodeURIComponent(rawUrl)}`
}

function normalizeUrl(value) {
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

function splitTrailingPunctuation(value) {
  const match = value.match(TRAILING_PUNCTUATION)
  if (!match) return [value, '']

  let url = value.slice(0, -match[0].length)
  let trailing = match[0]
  while (url.endsWith('(') && trailing.startsWith(')')) {
    url += ')'
    trailing = trailing.slice(1)
  }
  return [url, trailing]
}

function WffShareAnchor({ urlText, normalizedUrl, index }) {
  const [preview, setPreview] = useState(null)
  const sharePath = normalizeWffSharePath(normalizedUrl)

  useEffect(() => {
    let cancelled = false
    if (!sharePath) return undefined
    resolveWffShareUrl(normalizedUrl)
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [normalizedUrl, sharePath])

  const label = preview?.title || urlText
  const href = appPathForWffShare(normalizedUrl) || appBrowserPath(normalizedUrl)

  return (
    <a
      key={`${index}-${urlText}`}
      href={href}
      onClick={(event) => event.stopPropagation()}
      className="text-primary underline decoration-primary/40 underline-offset-2"
    >
      {label}
    </a>
  )
}

export default function RichText({ text, className = '' }) {
  const content = text || ''
  const nodes = []
  let lastIndex = 0

  for (const match of content.matchAll(URL_PATTERN)) {
    const matchedText = match[0]
    const index = match.index || 0
    if (index > lastIndex) nodes.push(content.slice(lastIndex, index))

    const [urlText, trailing] = splitTrailingPunctuation(matchedText)
    const normalizedUrl = normalizeUrl(urlText)
    nodes.push(<WffShareAnchor key={`${index}-${urlText}`} urlText={urlText} normalizedUrl={normalizedUrl} index={index} />)
    if (trailing) nodes.push(trailing)
    lastIndex = index + matchedText.length
  }

  if (lastIndex < content.length) nodes.push(content.slice(lastIndex))

  return <span className={className}>{nodes}</span>
}
