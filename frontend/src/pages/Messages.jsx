import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import MessageHub from '../components/MessageHub'
import BottomNav from '../components/BottomNav'

export default function Messages() {
  const navigate = useNavigate()
  const { user } = useStore()

  useEffect(() => {
    if (!user.username) {
      navigate('/login')
    }
  }, [user.username, navigate])

  const canUseMessages = Boolean(user.canPost && !user.isGuest)

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <p className="app-kicker">World Foresight Forum</p>
          <h1 className="app-title mt-2">Messages</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-7">
        {canUseMessages ? (
          <MessageHub />
        ) : (
          <div className="swiss-panel text-sm text-gray-400">
            Messages require a registered writer account.
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  )
}
