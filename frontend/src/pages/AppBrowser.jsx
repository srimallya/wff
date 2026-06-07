import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { IconButton } from '../components/Icons'

function safeBrowserUrl(value) {
  try {
    const url = new URL(value || '')
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href
  } catch (error) {
    return ''
  }
  return ''
}

export default function AppBrowser() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const targetUrl = useMemo(() => safeBrowserUrl(searchParams.get('url')), [searchParams])
  const host = targetUrl ? new URL(targetUrl).host : ''

  return (
    <div className="flex h-[100dvh] min-h-screen flex-col bg-dark-bg">
      <header className="app-header shrink-0">
        <div className="app-header-inner flex items-end justify-between gap-4">
          <IconButton onClick={() => navigate(-1)} icon="back" label="Back" />
          <div className="min-w-0 flex-1 text-right">
            <p className="truncate text-sm font-medium text-gray-100">{host || 'Link'}</p>
            {targetUrl && <p className="truncate text-[11px] text-gray-500">{targetUrl}</p>}
          </div>
        </div>
      </header>

      {targetUrl ? (
        <iframe
          title={host || 'In-app browser'}
          src={targetUrl}
          className="min-h-0 flex-1 border-0 bg-white"
          sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
        />
      ) : (
        <main className="flex flex-1 items-center justify-center px-5 text-center text-sm text-gray-500">
          This link cannot be opened.
        </main>
      )}
    </div>
  )
}
