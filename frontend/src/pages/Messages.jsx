import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import MessageHub from '../components/MessageHub'

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
          <button onClick={() => { resetFeedView(); navigate('/feed') }} className="text-gray-400 hover:text-white text-sm">Forum</button>
          {user.canPost && (
            <button onClick={() => navigate('/compose')} className="text-gray-400 hover:text-white text-sm">Write</button>
          )}
          <button onClick={() => navigate('/profile')} className="text-primary text-sm hover:underline">Profile</button>
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
