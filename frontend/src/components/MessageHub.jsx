import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { IconButton } from './Icons'

function EmptyState({ children }) {
  return (
    <div className="border-t border-dark-border px-0 py-5 text-center text-sm text-gray-500">
      {children}
    </div>
  )
}

function RequestNote({ note }) {
  if (!note) return null
  return (
    <p className="mt-3 whitespace-pre-wrap break-words border-l border-dark-border pl-3 text-sm text-gray-300">
      {note}
    </p>
  )
}

function loadNicknames() {
  try {
    return JSON.parse(localStorage.getItem('wff_friend_nicknames') || '{}')
  } catch (e) {
    return {}
  }
}

export default function MessageHub({ showTitle = true, panel = 'all' }) {
  const navigate = useNavigate()
  const {
    user,
    messagesHome,
    messagesLoading,
    messagesError,
    messageSearchResults,
    searchMessageUsers,
    clearMessageSearch,
    fetchMessagesHome,
    createMessageRequest,
    acceptMessageRequest,
    deleteMessageRequest,
  } = useStore()
  const [activePanel, setActivePanel] = useState(panel === 'all' ? 'threads' : panel)
  const [threadQuery, setThreadQuery] = useState('')
  const [peopleQuery, setPeopleQuery] = useState('')
  const [requestNote, setRequestNote] = useState('')
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [statusText, setStatusText] = useState('')
  const [busyRequestId, setBusyRequestId] = useState(null)
  const [startingUsername, setStartingUsername] = useState('')
  const [nicknames, setNicknames] = useState(() => loadNicknames())

  const visiblePanel = panel === 'all' ? activePanel : panel

  useEffect(() => {
    if (user.username) fetchMessagesHome()
  }, [user.username, fetchMessagesHome])

  useEffect(() => {
    if (messagesError === 'Please log in again to restore your private session.') {
      window.setTimeout(() => navigate('/login'), 0)
    }
  }, [messagesError, navigate])

  useEffect(() => {
    setActivePanel(panel === 'all' ? 'threads' : panel)
  }, [panel])

  useEffect(() => {
    const refreshNicknames = () => setNicknames(loadNicknames())
    window.addEventListener('focus', refreshNicknames)
    return () => window.removeEventListener('focus', refreshNicknames)
  }, [])

  const filteredThreads = useMemo(() => {
    const q = threadQuery.trim().toLowerCase()
    if (!q) return messagesHome.threads
    return messagesHome.threads.filter((thread) =>
      thread.other_user.username.toLowerCase().includes(q)
    )
  }, [messagesHome.threads, threadQuery])

  const handlePeopleSearch = async (e) => {
    e.preventDefault()
    setStatusText('')
    await searchMessageUsers(peopleQuery)
  }

  const openRequestModal = (person) => {
    setStatusText('')
    setRequestNote('')
    setSelectedPerson(person)
  }

  const closeRequestModal = () => {
    setSelectedPerson(null)
    setRequestNote('')
  }

  const handleStart = async () => {
    const note = requestNote.trim()
    const targetUsername = selectedPerson?.username
    if (!targetUsername) return
    if (!note) {
      setStatusText('Write a request note')
      return
    }
    setStatusText('')
    setStartingUsername(targetUsername)
    const result = await createMessageRequest(targetUsername, note)
    setStartingUsername('')
    if (result.success) {
      setPeopleQuery('')
      setRequestNote('')
      setSelectedPerson(null)
      clearMessageSearch()
      if (result.data?.conversation?.id) {
        navigate(`/messages/${result.data.conversation.id}`)
      } else {
        setStatusText('Request sent')
      }
    } else {
      setStatusText(result.error)
    }
  }

  const handleAccept = async (requestId) => {
    setStatusText('')
    setBusyRequestId(requestId)
    const result = await acceptMessageRequest(requestId)
    setBusyRequestId(null)
    if (result.success && result.conversation?.id) {
      navigate(`/messages/${result.conversation.id}`)
    } else {
      setStatusText(result.error)
    }
  }

  const handleCancel = async (requestId) => {
    setStatusText('')
    setBusyRequestId(requestId)
    const result = await deleteMessageRequest(requestId)
    setBusyRequestId(null)
    if (!result.success) setStatusText(result.error)
  }

  return (
    <div className="space-y-5">
      {showTitle && (
        <div className="flex items-center justify-between">
          <h1 className="app-title">Messages</h1>
          <IconButton onClick={() => navigate('/profile')} icon="profile" label="Back to profile" />
        </div>
      )}

      {panel === 'all' && (
        <div className="swiss-tabs">
          <button type="button" onClick={() => setActivePanel('threads')} className={`swiss-tab ${visiblePanel === 'threads' ? 'swiss-tab-active' : ''}`}>
            Conversations
          </button>
          <button type="button" onClick={() => setActivePanel('requests')} className={`swiss-tab ${visiblePanel === 'requests' ? 'swiss-tab-active' : ''}`}>
            Requests
          </button>
        </div>
      )}

      {(statusText || messagesError) && (
        <div className="border-l border-primary pl-3 text-sm text-red-400">
          {statusText || messagesError}
        </div>
      )}

      {messagesLoading ? (
        <div className="py-12 text-center text-sm text-gray-500">Loading...</div>
      ) : visiblePanel === 'threads' ? (
        <div className="space-y-4">
          <input
            type="text"
            value={threadQuery}
            onChange={(e) => setThreadQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary"
          />

          {filteredThreads.length === 0 ? (
            <EmptyState>
              {threadQuery.trim() ? 'No matches found' : 'No active conversations yet'}
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {filteredThreads.map((thread, index) => (
                <button
                  key={thread.id}
                  onClick={() => navigate(`/messages/${thread.id}`)}
                  className={`w-full border-t border-dark-border py-4 text-left ${index === 0 ? 'border-t-0' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`truncate font-medium ${thread.unread_count > 0 ? 'text-white' : 'text-primary'}`}>
                        {nicknames[thread.other_user.username] || thread.other_user.username}
                      </p>
                      {nicknames[thread.other_user.username] && (
                        <p className="mt-0.5 truncate text-xs text-gray-500">{thread.other_user.username}</p>
                      )}
                      <p className={`mt-1 truncate text-sm ${thread.unread_count > 0 ? 'text-gray-200' : 'text-gray-500'}`}>
                        {thread.last_message?.body || 'Open conversation'}
                      </p>
                    </div>
                    {thread.unread_count > 0 && (
                      <span className="shrink-0 text-xs font-semibold text-primary">
                        {thread.unread_count}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-300">New request</h2>
            <form onSubmit={handlePeopleSearch} className="relative">
              <input
                type="text"
                value={peopleQuery}
                onChange={(e) => setPeopleQuery(e.target.value)}
                placeholder="Search people..."
                className="w-full border-0 border-b py-3 pr-28 text-sm focus:outline-none focus:border-primary"
              />
              <IconButton
                type="submit"
                className="icon-button-primary absolute right-0 top-1/2 -translate-y-1/2"
                disabled={peopleQuery.trim().length < 2}
                icon="search"
                label="Search people"
              />
            </form>

            {messageSearchResults.length > 0 && (
              <div className="space-y-2 border-t border-dark-border pt-3">
                {messageSearchResults.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => openRequestModal(person)}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  >
                    <span className="min-w-0 truncate font-medium text-primary">{person.username}</span>
                    <span className="shrink-0 text-primary" aria-hidden="true">+</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {selectedPerson && (
            <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
              <button
                type="button"
                aria-label="Close request"
                onClick={closeRequestModal}
                className="absolute inset-0 bg-black/70"
              />
              <div className="relative w-full max-w-md border border-dark-border bg-dark-bg p-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-500">Send request</p>
                    <h2 className="truncate text-xl font-semibold text-primary">{selectedPerson.username}</h2>
                  </div>
                  <IconButton onClick={closeRequestModal} icon="close" label="Close" />
                </div>

                <div className="space-y-3">
                  <textarea
                    value={requestNote}
                    onChange={(e) => setRequestNote(e.target.value.slice(0, 128))}
                    placeholder="Write a request note..."
                    rows={4}
                    maxLength={128}
                    className="w-full resize-none border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-500">{requestNote.length}/128</span>
                    <IconButton
                      onClick={handleStart}
                      disabled={startingUsername === selectedPerson.username || !requestNote.trim()}
                      icon="send"
                      label={startingUsername === selectedPerson.username ? 'Sending' : 'Send request'}
                      className="icon-button-primary"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-300">Sent requests</h2>
            {messagesHome.pendingOutgoing.length === 0 ? (
              <EmptyState>No pending requests</EmptyState>
            ) : (
              <div className="space-y-2">
                {messagesHome.pendingOutgoing.map((request) => (
                  <div key={request.id} className="border-t border-dark-border py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-primary">{request.other_user.username}</p>
                        <p className="mt-1 text-sm text-gray-500">Waiting for reply</p>
                      </div>
                      <IconButton
                        onClick={() => handleCancel(request.id)}
                        disabled={busyRequestId === request.id}
                        icon="close"
                        label="Cancel"
                      />
                    </div>
                    <RequestNote note={request.note} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-300">Incoming requests</h2>
            {messagesHome.pendingIncoming.length === 0 ? (
              <EmptyState>No new requests</EmptyState>
            ) : (
              <div className="space-y-2">
                {messagesHome.pendingIncoming.map((request) => (
                  <div key={request.id} className="border-t border-dark-border py-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 truncate font-medium text-primary">{request.other_user.username}</p>
                      <div className="flex shrink-0 gap-2">
                        <IconButton
                          onClick={() => handleAccept(request.id)}
                          disabled={busyRequestId === request.id}
                          icon="check"
                          label="Accept"
                          className="icon-button-primary"
                        />
                        <IconButton
                          onClick={() => handleCancel(request.id)}
                          disabled={busyRequestId === request.id}
                          icon="close"
                          label="Cancel"
                        />
                      </div>
                    </div>
                    <RequestNote note={request.note} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
