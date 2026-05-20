import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import MessageHub from '../components/MessageHub'
import { IconButton } from '../components/Icons'

export default function Messages() {
  const navigate = useNavigate()
  const { user, resetFeedView } = useStore()

  useEffect(() => {
    if (!user.username) {
      navigate('/login')
    }
  }, [user.username, navigate])

  const canUseMessages = Boolean(user.canPost && !user.isGuest)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 bg-dark-bg/95 backdrop-blur border-b border-dark-border p-4 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <IconButton onClick={() => { resetFeedView(); navigate('/feed') }} icon="forum" label="Forum" />
          {user.canPost && (
            <IconButton onClick={() => navigate('/compose')} icon="edit" label="Write" />
          )}
          <IconButton onClick={() => navigate('/profile')} icon="profile" label="Profile" className="icon-button-primary" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {canUseMessages ? (
          <MessageHub />
        ) : (
          <div className="rounded-xl border border-dark-border bg-dark-card p-5 text-sm text-gray-400">
            Messages require a registered writer account.
          </div>
        )}
      </main>
    </div>
  )
}
