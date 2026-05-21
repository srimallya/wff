import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { IconButton } from '../components/Icons'

const APP_TIME_ZONE = 'Asia/Kolkata'
const SERVER_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function parseAppTimestamp(value) {
  if (!value) return null
  const normalized = SERVER_TIMESTAMP_PATTERN.test(value) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
    ? `${value}Z`
    : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function kolkataDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
}

function formatMessageTime(value) {
  const date = parseAppTimestamp(value)
  if (!date) return ''
  return date.toLocaleTimeString('en-US', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit' })
}

function dateBucket(value) {
  const date = parseAppTimestamp(value)
  if (!date) return ''
  const now = new Date()
  const today = kolkataDateParts(now)
  const messageDay = kolkataDateParts(date)
  const startOfToday = Date.UTC(today.year, today.month - 1, today.day)
  const startOfDate = Date.UTC(messageDay.year, messageDay.month - 1, messageDay.day)
  const diffDays = Math.floor((startOfToday - startOfDate) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return 'This week'
  if (messageDay.year === today.year && messageDay.month === today.month) return 'This month'
  if (messageDay.year === today.year) {
    return date.toLocaleDateString('bn-BD', { timeZone: APP_TIME_ZONE, month: 'long', day: 'numeric' })
  }
  return date.toLocaleDateString('bn-BD', { timeZone: APP_TIME_ZONE, year: 'numeric', month: 'long', day: 'numeric' })
}

const NICKNAME_KEY = 'wff_friend_nicknames'

function loadNicknames() {
  try {
    return JSON.parse(localStorage.getItem(NICKNAME_KEY) || '{}')
  } catch (e) {
    return {}
  }
}

function saveNicknames(value) {
  localStorage.setItem(NICKNAME_KEY, JSON.stringify(value))
}

function displayNameFor(username, nicknames) {
  return nicknames[username] || username
}

function messageExcerpt(message) {
  const text = (message?.body || '').replace(/\s+/g, ' ').trim()
  return text.length > 72 ? `${text.slice(0, 72)}...` : text
}

function displayMessageBody(body) {
  return (body || '').replace(/^Reply to\s+[^:\n]+:\s*/i, 'Reply to: ')
}

export default function Conversation() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { user, fetchConversation, sendConversationMessage, closeConversation, lastRealtimeEvent, joinConversation } = useStore()
  const [conversation, setConversation] = useState(null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [closingAction, setClosingAction] = useState('')
  const [nicknames, setNicknames] = useState(() => loadNicknames())
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const scrollRef = useRef(null)
  const bottomRef = useRef(null)

  const otherUsername = conversation?.other_user?.username || ''
  const otherDisplayName = useMemo(() => displayNameFor(otherUsername, nicknames), [otherUsername, nicknames])

  useEffect(() => {
    if (!user.username) {
      navigate('/login')
      return
    }
    if (!user.canPost || user.isGuest) {
      navigate('/profile')
      return
    }
    setLoading(true)
    fetchConversation(conversationId).then((result) => {
      if (result.success) {
        setConversation(result.conversation)
        setError('')
      } else {
        setError(result.error)
      }
      setLoading(false)
    })
  }, [conversationId, user.username, user.canPost, user.isGuest, navigate, fetchConversation])

  useEffect(() => {
    if (conversationId) joinConversation(conversationId)
  }, [conversationId, joinConversation])

  useEffect(() => {
    if (!lastRealtimeEvent || lastRealtimeEvent.type !== 'message_created') return
    const payload = lastRealtimeEvent.payload
    if (String(payload.conversation_id) !== String(conversationId) || !payload.message) return
    fetchConversation(conversationId).then((result) => {
      if (result.success) {
        setConversation(result.conversation)
        setError('')
      }
    })
  }, [lastRealtimeEvent, conversationId, fetchConversation, user])

  useEffect(() => {
    if (!lastRealtimeEvent || lastRealtimeEvent.type !== 'thread_removed') return
    if (String(lastRealtimeEvent.payload?.conversation_id) === String(conversationId)) {
      navigate('/messages')
    }
  }, [lastRealtimeEvent, conversationId, navigate])

  const handleConversationAction = async (action) => {
    setError('')
    setClosingAction(action)
    const result = await closeConversation(conversationId, action)
    setClosingAction('')
    if (result.success) {
      setActionsOpen(false)
      navigate('/messages')
    } else {
      setError(result.error)
    }
  }

  const handleSaveNickname = () => {
    if (!otherUsername) return
    const next = { ...nicknames }
    const clean = nicknameDraft.trim()
    if (clean) next[otherUsername] = clean.slice(0, 40)
    else delete next[otherUsername]
    saveNicknames(next)
    setNicknames(next)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    const outgoingBody = replyTo
      ? `Reply to: ${messageExcerpt(replyTo)}\n\n${trimmed}`
      : trimmed
    const clientNonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const optimisticMessage = {
      id: `pending-${clientNonce}`,
      sender_username: user.username,
      body: outgoingBody,
      created_at: new Date().toISOString(),
      is_mine: true,
      client_nonce: clientNonce,
      sending_status: 'sending',
    }
    setConversation((current) => ({
      ...current,
      messages: [...(current?.messages || []), optimisticMessage],
    }))
    setBody('')
    setReplyTo(null)
    setSending(true)
    const result = await sendConversationMessage(conversationId, outgoingBody, clientNonce, {
      ...conversation,
      messages: conversation?.messages || [],
    })
    setSending(false)
    if (result.success) {
      if (result.conversation) {
        setConversation({
          ...result.conversation,
          messages: (result.conversation.messages || []).map((message) =>
            message.client_nonce === clientNonce ? { ...message, sending_status: 'sent' } : message
          ),
        })
      } else {
        setConversation((current) => ({
          ...current,
          messages: (current?.messages || []).map((message) =>
            message.client_nonce === clientNonce
              ? { ...result.message, sending_status: 'sent' }
              : message
          ),
        }))
      }
      setError('')
    } else {
      setConversation((current) => ({
        ...current,
        messages: (current?.messages || []).map((message) =>
          message.client_nonce === clientNonce
            ? { ...message, sending_status: 'failed' }
            : message
        ),
      }))
      setError(result.error)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [conversation?.messages?.length, conversation?.id])

  useEffect(() => {
    if (actionsOpen) setNicknameDraft(nicknames[otherUsername] || '')
  }, [actionsOpen, nicknames, otherUsername])

  return (
    <div className="flex h-[100dvh] min-h-screen flex-col bg-dark-bg">
      <header className="app-header shrink-0">
        <div className="app-header-inner flex items-end justify-between gap-4">
          <IconButton onClick={() => navigate('/messages')} icon="back" label="Back to messages" />
          <IconButton
            type="button"
            onClick={() => conversation && setActionsOpen(true)}
            disabled={!conversation}
            icon="menu"
            label={otherDisplayName || 'Conversation'}
            className="icon-button-primary"
          />
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        {error && <div className="mx-4 mt-4 border-l border-primary pl-3 text-sm text-red-400">{error}</div>}
        {conversation?.transcript_verified === false && (
          <div className="mx-4 mt-4 border-l border-primary pl-3 text-sm text-red-500">
            Secure state warning: this conversation transcript could not be verified. {conversation.transcript_error || 'Refresh and try again.'}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-gray-500">Loading...</div>
        ) : conversation ? (
          <>
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {conversation.messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  No messages yet
                </div>
              ) : (
                conversation.messages.map((message, index) => {
                  const currentBucket = dateBucket(message.created_at)
                  const previousBucket = index > 0 ? dateBucket(conversation.messages[index - 1].created_at) : null
                  return (
                    <div key={message.id} className="space-y-3">
                      {currentBucket !== previousBucket && (
                        <div className="flex justify-center">
                          <span className="text-xs text-gray-400">
                            {currentBucket}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                        <button
                          type="button"
                          onClick={() => setReplyTo(message)}
                          className={`max-w-[78%] px-0 py-3 text-sm ${
                            message.is_mine
                              ? 'text-primary'
                              : 'text-gray-100'
                          } text-left`}
                        >
                          {!message.is_mine && (
                            <p className="mb-1 text-[11px] font-medium text-gray-500">
                              {displayNameFor(message.sender_username, nicknames)}
                              {nicknames[message.sender_username] && (
                                <span className="ml-2 font-normal">{message.sender_username}</span>
                              )}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap break-words">{displayMessageBody(message.body)}</p>
                          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-gray-500">
                            <span>{formatMessageTime(message.created_at)}</span>
                            <span aria-label={message.is_mine ? 'Read' : 'Received'}>
                              {message.sending_status === 'sending'
                                ? '…'
                                : message.sending_status === 'failed'
                                ? '!'
                                : message.is_mine
                                ? '✓✓'
                                : '✓'}
                            </span>
                          </div>
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            <form
              onSubmit={handleSubmit}
              className="sticky bottom-0 flex shrink-0 gap-5 border-t border-dark-border bg-dark-bg/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur"
            >
              {replyTo && (
                <div className="absolute bottom-full left-4 right-4 border-t border-dark-border bg-dark-bg px-0 py-2 text-xs text-gray-500">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">
                      Replying to {messageExcerpt(replyTo)}
                    </span>
                    <button type="button" onClick={() => setReplyTo(null)} className="shrink-0 text-primary">Cancel</button>
                  </div>
                </div>
              )}
              <input
                type="text"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a message..."
                className="min-w-0 flex-1 border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary"
              />
              <IconButton
                type="submit"
                disabled={sending || !body.trim()}
                icon="send"
                label="Send"
                className="icon-button-primary"
              />
            </form>
          </>
        ) : null}
      </main>

      {actionsOpen && conversation && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 px-4 py-4 sm:items-center">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setActionsOpen(false)}
            className="absolute inset-0"
          />
          <div className="relative w-full max-w-sm border border-dark-border bg-dark-card p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-gray-500">Conversation</p>
                <h2 className="break-words text-lg font-medium text-white">
                  {otherDisplayName}
                </h2>
                {nicknames[otherUsername] && (
                  <p className="mt-1 text-xs text-gray-500">{otherUsername}</p>
                )}
              </div>
              <IconButton
                type="button"
                onClick={() => setActionsOpen(false)}
                icon="close"
                label="Close"
              />
            </div>

            <div className="space-y-2">
              <div className="border-t border-dark-border py-3">
                <label className="block text-xs text-gray-500" htmlFor="friend-nickname">Nickname</label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id="friend-nickname"
                    type="text"
                    value={nicknameDraft}
                    onChange={(e) => setNicknameDraft(e.target.value)}
                    placeholder={otherUsername}
                    className="min-w-0 flex-1 border-0 border-b px-0 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                  <button type="button" onClick={handleSaveNickname} className="text-sm font-medium text-primary">
                    Save nickname
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleConversationAction('delete')}
                disabled={Boolean(closingAction)}
                className="w-full border-t border-dark-border py-3 text-left text-sm text-gray-100 disabled:opacity-60"
              >
                Delete chat
              </button>
              <button
                type="button"
                onClick={() => handleConversationAction('unfriend')}
                disabled={Boolean(closingAction)}
                className="w-full border-t border-dark-border py-3 text-left text-sm text-gray-100 disabled:opacity-60"
              >
                Remove connection
              </button>
              <button
                type="button"
                onClick={() => handleConversationAction('block')}
                disabled={Boolean(closingAction)}
                className="w-full border-t border-dark-border py-3 text-left text-sm font-semibold text-primary disabled:opacity-60"
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
