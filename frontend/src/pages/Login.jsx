import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'

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
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-primary">World Foresight Forum</h1>
          <p className="text-gray-400 text-sm">Log in</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-dark-card p-6 rounded-xl border border-dark-border space-y-4">
          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value={realUsername}
              onChange={(e) => setRealUsername(e.target.value)}
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white"
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
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white"
              placeholder="Password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <div className="flex justify-between text-sm">
          <button onClick={() => navigate('/forgot-password')} className="text-primary hover:underline">
            Forgot password?
          </button>
          <button onClick={() => navigate('/signup')} className="text-gray-400 hover:text-white">
            Create account
          </button>
        </div>

        <button onClick={() => navigate('/')} className="w-full text-center text-gray-500 hover:text-gray-300 text-sm">
          Go back
        </button>
      </div>
    </div>
  )
}
