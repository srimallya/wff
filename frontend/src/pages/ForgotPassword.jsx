import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../api'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [realUsername, setRealUsername] = useState('')
  const [userId, setUserId] = useState(null)
  const [questions, setQuestions] = useState({ q1: '', q2: '' })
  const [answers, setAnswers] = useState({ a1: '', a2: '' })
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleStep1 = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ real_username: realUsername }),
      })
      const d = await res.json()
      setLoading(false)
      if (res.ok) {
        setUserId(d.user_id)
        setQuestions({ q1: d.security_q1, q2: d.security_q2 })
        setStep(2)
      } else {
        setError(d.error || 'User not found')
      }
    } catch {
      setLoading(false)
      setError('Network error')
    }
  }

  const handleStep2 = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/verify-security`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          answer1: answers.a1,
          answer2: answers.a2,
        }),
      })
      const d = await res.json()
      setLoading(false)
      if (res.ok && d.verified) {
        setStep(3)
      } else {
        setError(d.error || 'Incorrect answers')
      }
    } catch {
      setLoading(false)
      setError('Network error')
    }
  }

  const handleStep3 = async () => {
    if (newPassword.length < 6) {
      return setError('Password must be at least 6 characters')
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, new_password: newPassword }),
      })
      const d = await res.json()
      setLoading(false)
      if (res.ok) {
        navigate('/login')
      } else {
        setError(d.error || 'Reset failed')
      }
    } catch {
      setLoading(false)
      setError('Network error')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-primary">World Foresight Forum</h1>
          <p className="text-gray-400 text-sm">Password recovery</p>
        </div>

        <div className="bg-dark-card p-6 rounded-xl border border-dark-border space-y-4">
          {error && <p className="text-red-500 text-sm">{error}</p>}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">Enter your username</p>
              <input
                type="text"
                value={realUsername}
                onChange={e => setRealUsername(e.target.value)}
                className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white"
                placeholder="Username"
              />
              <button
                onClick={handleStep1}
                disabled={loading}
                className="w-full px-4 py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {loading ? 'Please wait...' : 'Next'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">Answer the security questions</p>
              <div>
                <label className="block text-sm text-gray-400 mb-1">{questions.q1}</label>
                <input
                  type="text"
                  value={answers.a1}
                  onChange={e => setAnswers(a => ({ ...a, a1: e.target.value }))}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">{questions.q2}</label>
                <input
                  type="text"
                  value={answers.a2}
                  onChange={e => setAnswers(a => ({ ...a, a2: e.target.value }))}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white"
                />
              </div>
              <button
                onClick={handleStep2}
                disabled={loading}
                className="w-full px-4 py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">Set a new password</p>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white"
                placeholder="New password"
              />
              <button
                onClick={handleStep3}
                disabled={loading}
                className="w-full px-4 py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Set password'}
              </button>
            </div>
          )}
        </div>

        <button onClick={() => navigate('/login')} className="w-full text-center text-gray-500 hover:text-gray-300 text-sm">
          Back to login
        </button>
      </div>
    </div>
  )
}
