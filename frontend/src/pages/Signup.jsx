import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { API_BASE } from '../api'
import { IconButton } from '../components/Icons'

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
    <div className="min-h-screen px-5 py-8">
      <div className="mx-auto w-full max-w-md space-y-8">
        <div className="space-y-2 border-b border-dark-border pb-5">
          <p className="app-kicker">World Foresight Forum</p>
          <h1 className="app-title">Create account</h1>
        </div>

        {form.is_bengali !== false && (
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className={`h-px flex-1 ${item <= step ? 'bg-primary' : 'bg-dark-border'}`} />
            ))}
          </div>
        )}

        <div className="space-y-5">
          {error && <p className="border-l border-primary pl-3 text-sm text-red-500">{error}</p>}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">How do you want to enter?</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => handleIdentity(true)} className="border-t border-dark-border py-4 text-left text-sm text-gray-400 hover:text-primary">
                  Create writer account
                </button>
                <button onClick={() => handleIdentity(false)} className="border-t border-dark-border py-4 text-left text-sm text-gray-400 hover:text-primary">
                  Read as guest
                </button>
              </div>
            </div>
          )}

          {step === 'guest' && (
            <div className="space-y-4">
              <div className="border-t border-dark-border pt-4">
                <p className="text-sm text-gray-400">Your public name</p>
                <p className="text-xl font-semibold text-primary">{generatedName || '...'}</p>
                <p className="text-xs text-gray-500 mt-1">Shown publicly without your real login name.</p>
              </div>
              <p className="text-sm text-gray-400">Guest mode can read the forum, but cannot post or message.</p>
              <IconButton onClick={handleGuest} disabled={loading} icon="globe" label={loading ? 'Please wait' : 'Continue as guest'} className="icon-button-primary mx-auto" />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="border-t border-dark-border pt-4">
                <p className="text-sm text-gray-400">Your public name</p>
                <p className="text-xl font-semibold text-primary">{generatedName || '...'}</p>
                <p className="text-xs text-gray-500 mt-1">This is the name other people see.</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Login name</label>
                <input type="text" value={form.real_username} onChange={(event) => update('real_username', event.target.value)} className="w-full border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary" placeholder="Your private login name" />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input type="password" value={form.password} onChange={(event) => update('password', event.target.value)} className="w-full border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary" placeholder="At least 6 characters" />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Confirm password</label>
                <input type="password" value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} className="w-full border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary" placeholder="Repeat password" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Birthdate</label>
                <input type="date" value={form.birthdate} onChange={(event) => update('birthdate', event.target.value)} className="w-full min-w-0 appearance-none border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary" />
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
                  <input type="text" value={form[key]} onChange={(event) => update(key, event.target.value)} className="w-full border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary" />
                </div>
              ))}
            </div>
          )}

          {form.is_bengali !== false && step !== 'guest' && step > 1 && (
            <div className="flex gap-6 border-t border-dark-border pt-5">
              <IconButton onClick={() => setStep(step - 1)} icon="back" label="Back" />
              <IconButton onClick={validateStep} disabled={loading} icon={step === 4 ? 'check' : 'enter'} label={loading ? 'Please wait' : step === 4 ? 'Create account' : 'Continue'} className="icon-button-primary" />
            </div>
          )}
        </div>

        <IconButton onClick={() => navigate('/')} icon="back" label="Go back" />
      </div>
    </div>
  )
}
