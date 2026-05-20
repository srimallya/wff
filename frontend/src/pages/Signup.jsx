import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { API_BASE } from '../api'

const SECURITY_QUESTIONS = [
  'What was the name of your first school?',
  'What is the name of your favorite book?',
  'In which city did your parents meet or marry?',
  'What was the name of your first pet?',
  'What was the name of your favorite teacher?',
]

export default function Signup() {
  const navigate = useNavigate()
  const { register, setUser } = useStore()
  const [generatedName, setGeneratedName] = useState('')
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    real_username: '',
    password: '',
    confirmPassword: '',
    birthdate: '',
    is_bengali: null,
    security_q1: SECURITY_QUESTIONS[0],
    security_a1: '',
    security_q2: SECURITY_QUESTIONS[1],
    security_a2: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/auth/generate-username`)
      .then((response) => response.json())
      .then((data) => setGeneratedName(data.username))
  }, [])

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const handleIdentity = (canWrite) => {
    update('is_bengali', canWrite)
    setStep(canWrite ? 2 : 'guest')
  }

  const validateStep = () => {
    setError('')
    if (step === 2) {
      if (!form.real_username.trim()) return setError('Enter a login name')
      if (form.password.length < 6) return setError('Password must be at least 6 characters')
      if (form.password !== form.confirmPassword) return setError('Passwords do not match')
      setStep(3)
    } else if (step === 3) {
      if (!form.birthdate) return setError('Enter your birthdate')
      setStep(4)
    } else if (step === 4) {
      if (!form.security_a1.trim() || !form.security_a2.trim()) return setError('Answer both security questions')
      submit()
    }
  }

  const submit = async () => {
    setLoading(true)
    const result = await register({
      real_username: form.real_username.trim(),
      password: form.password,
      birthdate: form.birthdate,
      is_bengali: form.is_bengali,
      security_q1: form.security_q1,
      security_a1: form.security_a1,
      security_q2: form.security_q2,
      security_a2: form.security_a2,
    })
    setLoading(false)

    if (result.success) navigate('/feed')
    else setError(result.error || 'Registration failed')
  }

  const handleGuest = async () => {
    setLoading(true)
    const response = await fetch(`${API_BASE}/auth/init-guest`, { method: 'POST' })
    const data = await response.json()
    setUser({ ...data, canPost: false })
    setLoading(false)
    navigate('/feed')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-primary">World Foresight Forum</h1>
          <p className="text-gray-400 text-sm">Create account</p>
        </div>

        {form.is_bengali !== false && (
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className={`flex-1 h-1 rounded ${item <= step ? 'bg-primary' : 'bg-dark-border'}`} />
            ))}
          </div>
        )}

        <div className="bg-dark-card p-6 rounded-xl border border-dark-border space-y-4">
          {error && <p className="text-red-500 text-sm">{error}</p>}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">How do you want to enter?</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => handleIdentity(true)} className="p-4 rounded-lg border transition-all bg-dark-bg border-dark-border text-gray-400 hover:border-primary hover:text-primary">
                  Create writer account
                </button>
                <button onClick={() => handleIdentity(false)} className="p-4 rounded-lg border transition-all bg-dark-bg border-dark-border text-gray-400 hover:border-primary hover:text-primary">
                  Read as guest
                </button>
              </div>
            </div>
          )}

          {step === 'guest' && (
            <div className="space-y-4">
              <div className="bg-dark-bg p-4 rounded-lg border border-dark-border">
                <p className="text-sm text-gray-400">Your public name</p>
                <p className="text-xl font-bold text-primary">{generatedName || '...'}</p>
                <p className="text-xs text-gray-500 mt-1">Shown publicly without your real login name.</p>
              </div>
              <p className="text-sm text-gray-400">Guest mode can read the forum, but cannot post or message.</p>
              <button onClick={handleGuest} disabled={loading} className="w-full px-4 py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50">
                {loading ? 'Please wait...' : 'Continue as guest'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-dark-bg p-4 rounded-lg border border-dark-border">
                <p className="text-sm text-gray-400">Your public name</p>
                <p className="text-xl font-bold text-primary">{generatedName || '...'}</p>
                <p className="text-xs text-gray-500 mt-1">This is the name other people see.</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Login name</label>
                <input type="text" value={form.real_username} onChange={(event) => update('real_username', event.target.value)} className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white" placeholder="Your private login name" />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input type="password" value={form.password} onChange={(event) => update('password', event.target.value)} className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white" placeholder="At least 6 characters" />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Confirm password</label>
                <input type="password" value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white" placeholder="Repeat password" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Birthdate</label>
                <input type="date" value={form.birthdate} onChange={(event) => update('birthdate', event.target.value)} className="w-full min-w-0 appearance-none px-3 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white" />
                <p className="text-xs text-gray-500 mt-1">Private. Used only to calculate your age in a future scenario.</p>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">Security questions for password recovery</p>
              {[['security_a1', form.security_q1], ['security_a2', form.security_q2]].map(([key, question]) => (
                <div key={key}>
                  <label className="block text-sm text-gray-400 mb-1">{question}</label>
                  <input type="text" value={form[key]} onChange={(event) => update(key, event.target.value)} className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-primary text-white" />
                </div>
              ))}
            </div>
          )}

          {form.is_bengali !== false && step !== 'guest' && (
            <div className="flex gap-3">
              {step > 1 && (
                <button onClick={() => setStep(step - 1)} className="flex-1 px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-gray-400 hover:text-white">
                  Back
                </button>
              )}
              <button onClick={validateStep} disabled={loading} className="flex-1 px-4 py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50">
                {loading ? 'Please wait...' : step === 4 ? 'Create account' : 'Continue'}
              </button>
            </div>
          )}
        </div>

        <button onClick={() => navigate('/')} className="w-full text-center text-gray-500 hover:text-gray-300 text-sm">
          Go back
        </button>
      </div>
    </div>
  )
}
