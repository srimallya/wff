import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { decryptAstrMessage } from '../services/astrClient'
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
  return date.toLocaleTimeString('bn-BD', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' })
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

function advanceChannel(channel, message) {
  if (!channel || !message?.astr?.direction || message.astr.transcript_hash == null) return channel
  const counters = { ...(channel.counters || {}) }
  counters[message.astr.direction] = Math.max(Number(counters[message.astr.direction] || 0), Number(message.astr.counter || 0) + 1)
  return {
    ...channel,
    transcript_hash: message.astr.transcript_hash,
    counters,
  }
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
    setConversation((current) => {
      if (!current) return current
      const message = payload.message
      const messages = current.messages || []
      const existingIndex = messages.findIndex((item) =>
        item.id === message.id || (message.client_nonce && item.client_nonce === message.client_nonce)
      )
      if (existingIndex >= 0) {
        return {
          ...current,
          channel: advanceChannel(current.channel, message),
          messages: messages.map((item, index) =>
            index === existingIndex ? { ...message, sending_status: 'sent' } : item
          ),
        }
      }
      return {
        ...current,
        channel: advanceChannel(current.channel, message),
        messages: [...messages, { ...message, sending_status: 'sent' }],
      }
    })
    setConversation((current) => {
      if (!current) return current
      const last = current.messages[current.messages.length - 1]
      if (!last?.astr?.ciphertext || last.body) return current
      decryptAstrMessage(current, user, last).then((decrypted) => {
        if (decrypted.decrypt_failed) {
          fetchConversation(conversationId).then((result) => {
            if (result.success) {
              setConversation(result.conversation)
              setError('')
            }
          })
          return
        }
        setConversation((latest) => latest ? {
          ...latest,
          messages: latest.messages.map((item) => item.id === last.id ? { ...decrypted, sending_status: 'sent' } : item),
        } : latest)
      })
      return current
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    const clientNonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const optimisticMessage = {
      id: `pending-${clientNonce}`,
      sender_username: user.username,
      body: trimmed,
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
    setSending(true)
    const result = await sendConversationMessage(conversationId, trimmed, clientNonce, {
      ...conversation,
      messages: conversation?.messages || [],
    })
    setSending(false)
    if (result.success) {
      setConversation((current) => ({
        ...current,
        channel: advanceChannel(current?.channel, result.message),
        messages: (current?.messages || []).map((message) =>
          message.client_nonce === clientNonce
            ? { ...result.message, sending_status: 'sent' }
            : message
        ),
      }))
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

  return (
    <div className="flex h-[100dvh] min-h-screen flex-col bg-dark-bg">
      <header className="shrink-0 border-b border-dark-border bg-dark-bg/95 p-4 backdrop-blur z-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <IconButton onClick={() => navigate('/messages')} icon="back" label="Back to messages" />
          <IconButton
            type="button"
            onClick={() => conversation && setActionsOpen(true)}
            disabled={!conversation}
            icon="menu"
            label={conversation?.other_user?.username || 'Conversation'}
            className="icon-button-primary"
          />
          <IconButton onClick={() => navigate('/profile')} icon="profile" label="Profile" />
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        {error && <div className="mx-4 mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-gray-500">Loading...</div>
        ) : conversation ? (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
                          <span className="rounded-full bg-dark-card px-3 py-1 text-xs text-gray-400">
                            {currentBucket}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[78%] rounded-xl px-4 py-3 text-sm ${
                            message.is_mine
                              ? 'bg-primary text-white'
                              : 'bg-dark-bg text-gray-100 border border-dark-border'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                          <div className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${
                            message.is_mine ? 'text-white/75' : 'text-gray-500'
                          }`}>
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
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <form
              onSubmit={handleSubmit}
              className="sticky bottom-0 flex shrink-0 gap-2 border-t border-dark-border bg-dark-bg/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur"
            >
              <input
                type="text"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a message..."
                className="min-w-0 flex-1 rounded-xl border border-dark-border bg-dark-card px-4 py-3 focus:outline-none focus:border-primary"
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
          <div className="relative w-full max-w-sm rounded-xl border border-dark-border bg-dark-card p-4 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-gray-500">Conversation</p>
                <h2 className="break-words text-lg font-semibold text-white">
                  {conversation.other_user?.username}
                </h2>
              </div>
              <IconButton
                type="button"
                onClick={() => setActionsOpen(false)}
                icon="close"
                label="Close"
              />
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleConversationAction('delete')}
                disabled={Boolean(closingAction)}
                className="w-full rounded-lg border border-dark-border px-4 py-3 text-left text-sm text-gray-100 hover:border-primary disabled:opacity-60"
              >
                Delete chat
              </button>
              <button
                type="button"
                onClick={() => handleConversationAction('unfriend')}
                disabled={Boolean(closingAction)}
                className="w-full rounded-lg border border-dark-border px-4 py-3 text-left text-sm text-gray-100 hover:border-primary disabled:opacity-60"
              >
                Remove connection
              </button>
              <button
                type="button"
                onClick={() => handleConversationAction('block')}
                disabled={Boolean(closingAction)}
                className="w-full rounded-lg border border-red-900/60 px-4 py-3 text-left text-sm font-semibold text-primary hover:bg-red-950/30 disabled:opacity-60"
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
