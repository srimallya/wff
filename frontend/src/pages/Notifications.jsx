import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, apiFetch } from '../api'
import { useStore } from '../store/zustandStore'
import { Icon, IconButton } from '../components/Icons'
import BottomNav from '../components/BottomNav'

function formatNotificationTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

export default function Notifications() {
  const navigate = useNavigate()
  const { user } = useStore()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadNotifications() {
      if (!user.username) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      try {
        const res = await apiFetch(`${API_BASE}/notifications`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Notifications could not be loaded')
        if (!cancelled) setNotifications(data.notifications || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Notifications could not be loaded')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadNotifications()
    return () => { cancelled = true }
  }, [user.username])

  const openNotification = (notification) => {
    navigate(notification.url || `/posts/${notification.essay_id}`)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <p className="app-kicker">World Foresight Forum</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <Icon name="bell" className="h-5 w-5 text-primary" />
              <h1 className="app-title">Notifications</h1>
            </div>
            <IconButton type="button" onClick={() => navigate('/profile')} icon="back" label="Profile" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-6">
        {loading ? (
          <div className="py-12 text-center text-gray-500">Loading...</div>
        ) : error ? (
          <div className="border-l border-primary pl-3 text-sm text-red-500">{error}</div>
        ) : notifications.length === 0 ? (
          <div className="border-t border-dark-border py-12 text-center text-sm text-gray-500">
            No notifications yet
          </div>
        ) : (
          <div className="space-y-0">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => openNotification(notification)}
                className="block w-full border-t border-dark-border py-5 text-left"
              >
                <div className="flex items-start gap-3">
                  <Icon name="bell" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-gray-100">{notification.message}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {notification.kind === 'comment_reply' ? 'Comment reply' : 'Post comment'}
                      {formatNotificationTime(notification.created_at) ? ` - ${formatNotificationTime(notification.created_at)}` : ''}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  )
}
