import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { IconButton } from '../components/Icons'

export default function Login() {
  const navigate = useNavigate()
  const { login } = useStore()
  const [realUsername, setRealUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await login(realUsername, password)
    setLoading(false)

    if (result.success) {
      navigate('/feed')
    } else {
      setError(result.error || 'Login failed')
    }
  }

  return (
    <div className="min-h-screen px-5 py-8">
      <div className="mx-auto w-full max-w-md space-y-8">
        <div className="space-y-2 border-b border-dark-border pb-5">
          <p className="app-kicker">World Foresight Forum</p>
          <h1 className="app-title">Log in</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <p className="border-l border-primary pl-3 text-sm text-red-500">{error}</p>}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value={realUsername}
              onChange={(e) => setRealUsername(e.target.value)}
              className="w-full border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary"
              placeholder="Your username"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary"
              placeholder="Password"
              required
            />
          </div>

          <IconButton
            type="submit"
            disabled={loading}
            icon="enter"
            label={loading ? 'Logging in' : 'Log in'}
            className="icon-button-primary"
          />
        </form>

        <div className="flex justify-between border-t border-dark-border pt-5 text-sm">
          <IconButton onClick={() => navigate('/forgot-password')} icon="spark" label="Forgot password" />
          <IconButton onClick={() => navigate('/signup')} icon="profile" label="Create account" />
        </div>

        <IconButton onClick={() => navigate('/')} icon="back" label="Go back" />
      </div>
    </div>
  )
}
