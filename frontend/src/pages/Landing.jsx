import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'

export default function Landing() {
  const navigate = useNavigate()
  const { user, initGuest } = useStore()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="text-center space-y-8 max-w-2xl">
        <div className="space-y-2">
          <h1 className="text-5xl md:text-7xl font-bold text-primary mb-2">
            {user.username ? 'World Foresight Forum' : 'Future'}
          </h1>
          <p className="text-lg text-gray-400">
            {user.username
              ? 'A global forum for public foresight'
              : 'What future do you see coming?'}
          </p>
        </div>

        <p className="text-base text-gray-300 leading-relaxed max-w-lg mx-auto">
          Write and compare public foresight about policy, governance, climate,
          technology, culture, work, cities, and everyday life across the world.
        </p>

        <div className="space-y-3 pt-4">
          {user.username ? (
            <div className="space-y-3">
              <button
                onClick={() => navigate('/feed')}
                className="w-full max-w-sm mx-auto block px-8 py-4 bg-primary hover:bg-red-700 text-white text-lg font-semibold rounded-xl transition-all shadow-lg shadow-primary/20"
              >
                Open forum
              </button>
              <button
                onClick={() => navigate('/compose')}
                className="w-full max-w-sm mx-auto block px-8 py-3 bg-dark-card hover:bg-dark-border border border-dark-border text-gray-300 rounded-xl transition-colors text-sm"
              >
                Write
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => navigate('/login')}
                className="w-full max-w-sm mx-auto block px-8 py-4 bg-primary hover:bg-red-700 text-white text-lg font-semibold rounded-xl transition-all shadow-lg shadow-primary/20"
              >
                Log in
              </button>
              <button
                onClick={async () => {
                  await initGuest()
                  navigate('/feed')
                }}
                className="w-full max-w-sm mx-auto block px-8 py-3 bg-dark-card hover:bg-dark-border border border-dark-border text-gray-400 rounded-xl transition-colors text-sm"
              >
                Continue as guest
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
