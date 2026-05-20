import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { Icon, IconButton } from '../components/Icons'

export default function Landing() {
  const navigate = useNavigate()
  const { user, initGuest } = useStore()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="text-center space-y-8 max-w-3xl swiss-squircle border border-dark-border bg-dark-card px-8 py-12 shadow-[0_24px_80px_rgba(17,17,17,0.08)]">
        <div className="space-y-2">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-white">
            <Icon name="globe" className="h-8 w-8" />
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-swiss-black mb-2">
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
              <IconButton
                onClick={() => navigate('/feed')}
                icon="forum"
                label="Open forum"
                className="icon-button-primary mx-auto"
              />
              <IconButton
                onClick={() => navigate('/compose')}
                icon="edit"
                label="Write"
                className="mx-auto"
              />
            </div>
          ) : (
            <div className="flex justify-center gap-3 pt-2">
              <IconButton
                onClick={() => navigate('/login')}
                icon="enter"
                label="Log in"
                className="icon-button-primary"
              />
              <IconButton
                onClick={async () => {
                  await initGuest()
                  navigate('/feed')
                }}
                icon="globe"
                label="Continue as guest"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
