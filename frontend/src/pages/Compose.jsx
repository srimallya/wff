import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import EssayComposer from '../components/EssayComposer'
import { IconButton } from '../components/Icons'
import BottomNav from '../components/BottomNav'

export default function Compose() {
  const navigate = useNavigate()
  const { user, createEssay, resetFeedView } = useStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!user.username) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-dark-card p-8 rounded-xl border border-dark-border text-center space-y-6 max-w-md">
          <h2 className="text-xl font-semibold">Log in to write</h2>
          <IconButton onClick={() => navigate('/login')} icon="enter" label="Log in" className="icon-button-primary mx-auto" />
        </div>
      </div>
    )
  }

  if (user.isGuest || !user.canPost) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-dark-card p-8 rounded-xl border border-dark-border text-center space-y-6 max-w-md">
          <h2 className="text-xl font-semibold">A writing account is required</h2>
          <p className="text-gray-400 text-sm">Guests can read, but cannot post.</p>
          <IconButton onClick={() => navigate('/signup')} icon="profile" label="Create account" className="icon-button-primary mx-auto" />
        </div>
      </div>
    )
  }

  const handleSubmit = async (essayData) => {
    setError('')
    setIsSubmitting(true)
    const result = await createEssay(essayData)
    setIsSubmitting(false)
    if (result && !result.error) {
      navigate('/feed')
      return
    }
    setError(result?.error || 'Post failed')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <p className="app-kicker">World Foresight Forum</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <h1 className="app-title">Write</h1>
            <button type="button" onClick={() => { resetFeedView(); navigate('/feed') }} className="text-sm text-gray-500">
              Cancel
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-5 py-6 space-y-7">
        {error && <p className="border-l border-primary pl-3 text-sm text-red-500">{error}</p>}
        <EssayComposer onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      </main>
      <BottomNav />
    </div>
  )
}
