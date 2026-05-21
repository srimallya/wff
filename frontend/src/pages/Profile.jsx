import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import EssayCard from '../components/EssayCard'
import Chatroom from '../components/Chatroom'
import MessageHub from '../components/MessageHub'
import { Icon, IconButton } from '../components/Icons'
import BottomNav from '../components/BottomNav'

export default function Profile() {
  const navigate = useNavigate()
  const {
    user,
    clearUser,
    deleteAccount,
    fetchUserEssays,
    resetFeedView,
    fetchNotificationKey,
    savePushSubscription,
    deletePushSubscription,
  } = useStore()
  const [showDelete, setShowDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [myEssays, setMyEssays] = useState([])
  const [essaysLoading, setEssaysLoading] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [activeView, setActiveView] = useState('messages')
  const [copiedUsername, setCopiedUsername] = useState(false)
  const [notificationsOn, setNotificationsOn] = useState(
    localStorage.getItem('wff_notifications') === 'true'
  )
  const [notificationStatus, setNotificationStatus] = useState('')
  const canUsePrivateFeatures = Boolean(user.canPost && !user.isGuest)

  useEffect(() => {
    if (user.username && canUsePrivateFeatures) {
      setEssaysLoading(true)
      fetchUserEssays(user.username).then((essays) => {
        setMyEssays(essays)
        setEssaysLoading(false)
      })
    } else {
      setMyEssays([])
      setEssaysLoading(false)
    }
  }, [user.username, canUsePrivateFeatures, fetchUserEssays])

  const handleLogout = () => {
    clearUser()
    navigate('/')
  }

  const closeActions = () => {
    setActionsOpen(false)
    setShowDelete(false)
    setDeletePassword('')
    setDeleteError('')
  }

  const copyPublicName = async () => {
    try {
      await navigator.clipboard.writeText(user.username)
      setCopiedUsername(true)
      window.setTimeout(() => setCopiedUsername(false), 1500)
    } catch (e) {
      setCopiedUsername(false)
    }
  }

  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
  }

  const toggleNotifications = async () => {
    setNotificationStatus('')
    let next = !notificationsOn
    if (!canUsePrivateFeatures) {
      setNotificationStatus('Notifications are not available for this account')
      return
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setNotificationStatus('Notifications are not available in this browser')
      return
    }

    const registration = import.meta.env.DEV
      ? await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      : await navigator.serviceWorker.ready

    if (!next) {
      const existing = await registration.pushManager.getSubscription()
      if (existing) {
        await deletePushSubscription(existing.endpoint)
        await existing.unsubscribe()
      }
      setNotificationsOn(false)
      localStorage.setItem('wff_notifications', 'false')
      return
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      next = permission === 'granted'
    } else if (Notification.permission === 'denied') {
      next = false
    }

    if (!next) {
      setNotificationStatus('Notification permission was not granted')
      setNotificationsOn(false)
      localStorage.setItem('wff_notifications', 'false')
      return
    }

    const key = await fetchNotificationKey()
    if (!key.success || !key.configured || !key.publicKey) {
      setNotificationStatus('Push server is not configured')
      return
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key.publicKey),
    })
    const saved = await savePushSubscription(subscription.toJSON())
    if (saved.success) {
      setNotificationsOn(true)
      localStorage.setItem('wff_notifications', 'true')
    } else {
      setNotificationStatus(saved.error || 'Notifications could not be enabled')
    }
  }

  const handleDelete = async () => {
    setDeleteError('')
    if (!deletePassword) {
      setDeleteError('Enter your password')
      return
    }
    setDeleting(true)
    const result = await deleteAccount(user.realUsername, deletePassword, user.username)
    setDeleting(false)
    if (result.success) {
      navigate('/')
    } else {
      setDeleteError(result.error || 'Delete failed')
    }
  }

  const handleGuestDelete = async () => {
    setDeleteError('')
    setDeleting(true)
    const result = await deleteAccount(null, null, user.username)
    setDeleting(false)
    if (result.success) {
      navigate('/')
    } else {
      setDeleteError(result.error || 'Delete failed')
    }
  }

  const openSupport = () => {
    window.location.href = 'https://razorpay.me/@trustcommons'
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <p className="app-kicker">World Foresight Forum</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <h1 className="app-title">Profile</h1>
            <button type="button" onClick={() => setActionsOpen(true)} className="swiss-action text-sm">
              Account
            </button>
          </div>
        </div>
      </header>

      {actionsOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeActions}
            className="absolute inset-0 bg-black/50"
          />
          <aside className="absolute right-0 top-0 h-full w-[min(22rem,calc(100vw-2rem))] border-l border-dark-border bg-dark-bg">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-dark-border px-5 py-4">
                <h2 className="app-title">Account</h2>
                <IconButton onClick={closeActions} icon="close" label="Close" />
              </div>

              <div className="flex-1 overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] space-y-5">
                <div className="swiss-panel space-y-4">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-400">Public name</p>
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 break-words text-2xl font-semibold text-primary">{user.username}</p>
                      <button
                        type="button"
                        onClick={copyPublicName}
                        aria-label={copiedUsername ? 'Copied' : 'Copy public name'}
                        title={copiedUsername ? 'Copied' : 'Copy public name'}
                        className="shrink-0 text-gray-500 hover:text-primary"
                      >
                        <Icon name={copiedUsername ? 'check' : 'copy'} className="h-5 w-5" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">Visible to everyone</p>
                  </div>

                  {user.realUsername && (
                    <div className="space-y-1">
                      <p className="text-sm text-gray-400">Login name</p>
                      <p className="break-words text-sm">{user.realUsername}</p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <p className="text-sm text-gray-400">Status</p>
                    <p className="text-sm">
                      {user.isGuest
                        ? 'Guest'
                        : user.isBengali
                        ? 'Writer account'
                        : 'Guest reader'}
                    </p>
                  </div>

                  {user.birthdate && (
                    <div className="space-y-1">
                      <p className="text-sm text-gray-400">Birthdate</p>
                      <p className="text-sm">{user.birthdate}</p>
                      <p className="text-xs text-gray-500">Private. Nobody else can see this.</p>
                    </div>
                  )}
                </div>

                {canUsePrivateFeatures && (
                  <div className="swiss-panel">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-200">PWA notifications</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {notificationsOn ? 'On' : 'Off'}
                        </p>
                        {notificationStatus && (
                          <p className="mt-1 text-xs text-red-400">{notificationStatus}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={toggleNotifications}
                        className={`relative h-7 w-12 rounded-full transition-colors ${notificationsOn ? 'bg-primary' : 'bg-dark-border'}`}
                        aria-pressed={notificationsOn}
                        aria-label="PWA notifications"
                      >
                        <span
                          className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                            notificationsOn ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                )}

                <IconButton
                  onClick={handleLogout}
                  icon="back"
                  label="Log out"
                  className="mx-auto"
                />

                {!user.isGuest ? (
                  <div className="space-y-3">
                    <IconButton
                      onClick={() => setShowDelete(!showDelete)}
                      icon={showDelete ? 'close' : 'delete'}
                      label={showDelete ? 'Cancel' : 'Delete account'}
                      className="mx-auto"
                    />

                    {showDelete && (
                      <div className="swiss-panel space-y-3">
                        <p className="text-sm text-red-400">Confirm with your password</p>
                        {deleteError && <p className="text-red-500 text-sm">{deleteError}</p>}
                        <input
                          type="password"
                          value={deletePassword}
                          onChange={e => setDeletePassword(e.target.value)}
                          placeholder="Password"
                          className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-red-500 text-white"
                        />
                        <IconButton
                          onClick={handleDelete}
                          disabled={deleting}
                          icon="delete"
                          label={deleting ? 'Deleting' : 'Delete permanently'}
                          className="icon-button-primary mx-auto"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <IconButton
                      onClick={() => setShowDelete(!showDelete)}
                      icon={showDelete ? 'close' : 'delete'}
                      label={showDelete ? 'Cancel' : 'Delete guest account'}
                      className="mx-auto"
                    />

                    {showDelete && (
                      <div className="swiss-panel space-y-3">
                        <p className="text-sm text-gray-400">Delete this guest account?</p>
                        {deleteError && <p className="text-red-500 text-sm">{deleteError}</p>}
                        <IconButton
                          onClick={handleGuestDelete}
                          disabled={deleting}
                          icon="delete"
                          label={deleting ? 'Deleting' : 'Delete permanently'}
                          className="icon-button-primary mx-auto"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="swiss-panel">
                  <p className="text-sm font-semibold text-gray-100">Support</p>
                  <p className="mt-1 text-sm text-gray-400">
                    Help keep this platform running and improving.
                  </p>
                  <IconButton
                    type="button"
                    onClick={openSupport}
                    icon="support"
                    label="Support"
                    className="icon-button-primary mt-4"
                  />
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-7">
        {canUsePrivateFeatures ? (
          <>
            <div className="swiss-tabs">
              <button type="button" onClick={() => setActiveView('messages')} className={`swiss-tab ${activeView === 'messages' ? 'swiss-tab-active' : ''}`}>
                Messages
              </button>
              <button type="button" onClick={() => setActiveView('chatroom')} className={`swiss-tab ${activeView === 'chatroom' ? 'swiss-tab-active' : ''}`}>
                Chatroom
              </button>
              <button type="button" onClick={() => setActiveView('essays')} className={`swiss-tab ${activeView === 'essays' ? 'swiss-tab-active' : ''}`}>
                My posts
              </button>
            </div>

            {activeView === 'messages' ? (
              <MessageHub showTitle={false} panel="all" />
            ) : activeView === 'chatroom' ? (
              <Chatroom />
            ) : (
              <div className="space-y-4">
                {essaysLoading ? (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : myEssays.length === 0 ? (
                  <div className="py-12 text-center text-sm text-gray-500">
                    <p>You have not written anything yet</p>
                    <IconButton onClick={() => navigate('/compose')} icon="edit" label="Write the first post" className="icon-button-primary mt-4" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {myEssays.map((essay) => (
                      <EssayCard key={essay.id} essay={essay} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="swiss-panel space-y-3">
            <p className="text-sm font-semibold text-gray-200">Account</p>
            <p className="text-sm text-gray-400">
              Guest accounts cannot use messages, requests, notifications, or personal post management.
            </p>
            <IconButton
              type="button"
              onClick={() => setActionsOpen(true)}
              icon="profile"
              label="View account"
              className="icon-button-primary mx-auto"
            />
          </div>
        )}

      </main>
      <BottomNav />
    </div>
  )
}
