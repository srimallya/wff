import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { IconButton } from '../components/Icons'

export default function Landing() {
  const navigate = useNavigate()
  const { user, initGuest } = useStore()

  return (
    <div className="min-h-screen px-5 py-8">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-3xl flex-col justify-between">
        <div className="flex justify-between text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-gray-500">
          <span>World</span>
          <span>Foresight</span>
          <span>Forum</span>
        </div>

        <div className="space-y-8">
          <h1 className="max-w-xl text-5xl font-medium leading-[1.02] text-swiss-black md:text-7xl">
            {user.username ? 'World Foresight Forum' : 'Future'}
          </h1>
          <p className="max-w-md text-base text-gray-400">
            {user.username
              ? 'A global forum for public foresight'
              : 'What future do you see coming?'}
          </p>

          <p className="max-w-lg border-t border-dark-border pt-5 text-sm leading-relaxed text-gray-300">
            Write and compare public foresight about policy, governance, climate,
            technology, culture, work, cities, and everyday life across the world.
          </p>
        </div>

        <div className="space-y-4 border-t border-dark-border pt-5">
          {user.username ? (
            <div className="flex justify-end">
              <IconButton
                onClick={() => navigate('/feed')}
                icon="enter"
                label="Enter"
                className="icon-button-primary"
              />
            </div>
          ) : (
            <div className="flex gap-6">
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
