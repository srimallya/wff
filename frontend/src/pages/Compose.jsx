import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import EssayComposer from '../components/EssayComposer'

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
          <button onClick={() => navigate('/login')} className="px-6 py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-semibold">
            Log in
          </button>
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
          <button onClick={() => navigate('/signup')} className="px-6 py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-semibold">
            Create account
          </button>
        </div>
      </div>
    )
  }

  const handleSubmit = async (essayData) => {
    setError('')
    setIsSubmitting(true)
    createEssay(essayData).then((result) => {
      setIsSubmitting(false)
      if (result && result.error) setError(result.error)
    })
    navigate('/feed')
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 bg-dark-bg/95 backdrop-blur border-b border-dark-border p-4 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button onClick={() => { resetFeedView(); navigate('/feed') }} className="text-gray-400 hover:text-white text-sm">Forum</button>
          <h1 className="text-sm font-semibold">Write</h1>
          <button onClick={() => navigate('/profile')} className="text-primary text-sm hover:underline">Profile</button>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {error && <p className="text-red-500 text-sm bg-red-500/10 p-3 rounded-lg">{error}</p>}
        <EssayComposer onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      </main>
    </div>
  )
}
