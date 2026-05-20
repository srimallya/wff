import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import Compose from './pages/Compose'
import Feed from './pages/Feed'
import PostDetail from './pages/PostDetail'
import Profile from './pages/Profile'
import Messages from './pages/Messages'
import Conversation from './pages/Conversation'
import { useStore } from './store/zustandStore'

const routerBasename = import.meta.env.BASE_URL === '/'
  ? undefined
  : import.meta.env.BASE_URL.replace(/\/$/, '')

function App() {
  const { user, initRealtime } = useStore()
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 650)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (user.username && user.canPost) initRealtime()
  }, [user.username, user.canPost, initRealtime])

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark-bg text-white">
        <div className="relative h-20 w-20">
          <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-primary" />
          <div className="absolute inset-5 rounded-full bg-primary" />
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter basename={routerBasename}>
      <div className="min-h-screen bg-dark-bg text-swiss-black">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/posts/:postId" element={<PostDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/messages/:conversationId" element={<Conversation />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
