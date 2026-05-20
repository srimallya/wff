import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, resetFeedView } = useStore()

  const goFeed = () => {
    resetFeedView()
    navigate('/feed')
  }

  const items = [
    { label: 'Forum', path: '/feed', action: goFeed },
    { label: 'Write', path: '/compose', hidden: !user.canPost, action: () => navigate('/compose') },
    { label: 'Profile', path: '/profile', action: () => navigate('/profile') },
  ].filter((item) => !item.hidden)

  return (
    <nav className="bottom-tabbar" aria-label="Primary">
      <div className="bottom-tabbar-inner" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = location.pathname === item.path || (item.path === '/profile' && location.pathname.startsWith('/messages'))
          return (
            <button
              key={item.label}
              type="button"
              onClick={item.action}
              className={`bottom-tab ${active ? 'bottom-tab-active' : ''}`}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
