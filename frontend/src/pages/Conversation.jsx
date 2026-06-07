import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/zustandStore'
import { IconButton } from '../components/Icons'
import { API_BASE } from '../api'
import { acceptConversationIdentityChange, markConversationIdentityVerified } from '../services/astrClient'
import RichText from '../components/RichText'

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
    return date.toLocaleDateString('en-US', { timeZone: APP_TIME_ZONE, month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('en-US', { timeZone: APP_TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric' })
}

const NICKNAME_KEY = 'wff_friend_nicknames'
const MESSAGE_PAGE_LIMIT = 40

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

function mediaUrl(message) {
  const path = message?.media?.url
  if (!path) return ''
  return `${API_BASE}${path}`
}

function formatBytes(value) {
  if (!value) return ''
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function mediaLabel(media) {
  if (!media) return ''
  if (media.kind === 'image') return 'Image'
  if (media.kind === 'audio') return 'Voice note'
  if (media.kind === 'video') return 'Video'
  return media.filename || 'File'
}

function uniqueMessages(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = item.client_nonce || item.id
    if (seen.has(String(key))) return false
    seen.add(String(key))
    return true
  })
}

export default function Conversation() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { user, fetchConversation, fetchConversationMessages, sendConversationMessage, uploadConversationMedia, closeConversation, lastRealtimeEvent, joinConversation } = useStore()
  const [conversation, setConversation] = useState(null)
  const [messagePagination, setMessagePagination] = useState(null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [mediaSending, setMediaSending] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [closingAction, setClosingAction] = useState('')
  const [securityUpdating, setSecurityUpdating] = useState('')
  const [nicknames, setNicknames] = useState(() => loadNicknames())
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [inputFocused, setInputFocused] = useState(false)
  const [mediaPreview, setMediaPreview] = useState(null)
  const [recording, setRecording] = useState(false)
  const scrollRef = useRef(null)
  const bottomRef = useRef(null)
  const mediaInputRef = useRef(null)
  const recorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const didInitialScrollRef = useRef(false)
  const keepAtBottomRef = useRef(false)
  const processedRealtimeMessageRef = useRef('')

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
    didInitialScrollRef.current = false
    fetchConversation(conversationId, { limit: MESSAGE_PAGE_LIMIT }).then((result) => {
      if (result.success) {
        setConversation(result.conversation)
        setMessagePagination(result.conversation.messages_pagination || null)
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

  const loadOlderMessages = useCallback(async () => {
    if (!conversation || loadingOlder || !messagePagination?.has_older) return
    const oldestId = messagePagination.oldest_id || conversation.messages?.[0]?.id
    if (!oldestId) return
    const scroller = scrollRef.current
    const previousHeight = scroller?.scrollHeight || 0
    const previousTop = scroller?.scrollTop || 0
    setLoadingOlder(true)
    const result = await fetchConversationMessages(conversation, {
      beforeId: oldestId,
      limit: MESSAGE_PAGE_LIMIT,
      reconcileState: false,
    })
    setLoadingOlder(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setConversation((current) => ({
      ...current,
      messages: uniqueMessages([...(result.messages || []), ...(current?.messages || [])]),
    }))
    setMessagePagination((current) => ({
      ...(current || {}),
      ...(result.pagination || {}),
      newest_id: current?.newest_id || result.pagination?.newest_id,
      has_newer: current?.has_newer || false,
    }))
    requestAnimationFrame(() => {
      if (!scrollRef.current) return
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight - previousHeight + previousTop
    })
  }, [conversation, fetchConversationMessages, loadingOlder, messagePagination])

  const loadNewerMessages = useCallback(async () => {
    if (!conversation || !messagePagination?.has_newer) return
    const newestId = messagePagination.newest_id || conversation.messages?.[conversation.messages.length - 1]?.id
    if (!newestId) return
    const result = await fetchConversationMessages(conversation, {
      afterId: newestId,
      limit: MESSAGE_PAGE_LIMIT,
      reconcileState: true,
    })
    if (!result.success) {
      setError(result.error)
      return
    }
    setConversation((current) => ({
      ...current,
      messages: uniqueMessages([...(current?.messages || []), ...(result.messages || [])]),
    }))
    setMessagePagination((current) => ({
      ...(current || {}),
      ...(result.pagination || {}),
      oldest_id: current?.oldest_id || result.pagination?.oldest_id,
    }))
  }, [conversation, fetchConversationMessages, messagePagination])

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    if (scroller.scrollTop < 96) loadOlderMessages()
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96) loadNewerMessages()
  }, [loadNewerMessages, loadOlderMessages])

  useEffect(() => {
    if (!lastRealtimeEvent || lastRealtimeEvent.type !== 'message_created') return
    const payload = lastRealtimeEvent.payload
    if (String(payload.conversation_id) !== String(conversationId) || !payload.message) return
    const eventKey = String(payload.message.client_nonce || payload.message.id || lastRealtimeEvent.receivedAt)
    if (processedRealtimeMessageRef.current === eventKey) return
    processedRealtimeMessageRef.current = eventKey
    const scroller = scrollRef.current
    keepAtBottomRef.current = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
    if (conversation) {
      fetchConversationMessages(conversation, {
        afterId: messagePagination?.newest_id || conversation.messages?.[conversation.messages.length - 1]?.id,
        limit: MESSAGE_PAGE_LIMIT,
        reconcileState: true,
      }).then((result) => {
        if (!result.success) {
          setError(result.error)
          return
        }
        setConversation((current) => ({
          ...current,
          messages: uniqueMessages([...(current?.messages || []), ...(result.messages || [])]),
          last_message: payload.thread?.last_message || current?.last_message,
          updated_at: payload.thread?.updated_at || current?.updated_at,
        }))
        setMessagePagination((current) => ({
          ...(current || {}),
          ...(result.pagination || {}),
          oldest_id: current?.oldest_id || result.pagination?.oldest_id,
        }))
        setError('')
      })
    } else if (payload.thread) {
      setConversation({ ...payload.thread, messages: [payload.message] })
    }
  }, [lastRealtimeEvent, conversationId, conversation, fetchConversationMessages, messagePagination])

  useEffect(() => {
    if (!lastRealtimeEvent || lastRealtimeEvent.type !== 'thread_removed') return
    if (String(lastRealtimeEvent.payload?.conversation_id) === String(conversationId)) {
      navigate('/messages')
    }
  }, [lastRealtimeEvent, conversationId, navigate])

  useEffect(() => {
    if (!lastRealtimeEvent || lastRealtimeEvent.type !== 'media_deleted') return
    if (String(lastRealtimeEvent.payload?.conversation_id) !== String(conversationId)) return
    setConversation((current) => ({
      ...current,
      messages: (current?.messages || []).filter((message) =>
        String(message.id) !== String(lastRealtimeEvent.payload?.message_id)
      ),
    }))
  }, [lastRealtimeEvent, conversationId])

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

  const handleMarkIdentityVerified = async () => {
    if (!conversation) return
    setSecurityUpdating('verify')
    try {
      const security = await markConversationIdentityVerified(conversation, user)
      setConversation((current) => ({ ...current, security }))
    } finally {
      setSecurityUpdating('')
    }
  }

  const handleAcceptIdentityChange = async () => {
    if (!conversation) return
    setSecurityUpdating('accept')
    try {
      await acceptConversationIdentityChange(conversation, user)
      const result = await fetchConversation(conversationId)
      if (result.success) {
        setConversation(result.conversation)
        setError('')
      }
    } finally {
      setSecurityUpdating('')
    }
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
    keepAtBottomRef.current = true
    setBody('')
    setReplyTo(null)
    setSending(true)
    const result = await sendConversationMessage(conversationId, outgoingBody, clientNonce, {
      ...conversation,
      messages: conversation?.messages || [],
    })
    setSending(false)
    if (result.success) {
      setConversation((current) => ({
        ...current,
        messages: uniqueMessages((current?.messages || []).map((message) =>
          message.client_nonce === clientNonce
            ? { ...result.message, sending_status: 'sent' }
            : message
        )),
      }))
      setMessagePagination((current) => ({
        ...(current || {}),
        newest_id: result.message?.id || current?.newest_id,
        has_newer: false,
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

  const handleUploadFile = async (file) => {
    if (!file || mediaSending) return
    setError('')
    setMediaSending(true)
    const clientNonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const result = await uploadConversationMedia(conversationId, file, clientNonce)
    setMediaSending(false)
    if (result.success) {
      keepAtBottomRef.current = true
      setConversation((current) => ({
        ...current,
        messages: uniqueMessages([...(current?.messages || []), { ...result.message, sending_status: 'sent' }]),
      }))
      setMessagePagination((current) => ({
        ...(current || {}),
        newest_id: result.message?.id || current?.newest_id,
        has_newer: false,
      }))
    } else {
      setError(result.error)
    }
  }

  const handleFileInput = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    handleUploadFile(file)
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Voice recording is not supported in this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data?.size) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size) {
          const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type || 'audio/webm' })
          handleUploadFile(file)
        }
      }
      recorder.start()
      setRecording(true)
    } catch (e) {
      setError('Microphone permission is required for voice notes')
    }
  }

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    setRecording(false)
  }

  const openMedia = (message) => {
    const url = mediaUrl(message)
    if (!url) return
    if (['image', 'video'].includes(message.media?.kind)) {
      setMediaPreview({ message, url })
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    if (!conversation?.id) return
    if (!didInitialScrollRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
      didInitialScrollRef.current = true
      return
    }
    if (keepAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
      keepAtBottomRef.current = false
    }
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
            {conversation.identity_changed
              ? 'Secure identity changed. Review security details before sending.'
              : `Secure state warning: this conversation transcript could not be verified. ${conversation.transcript_error || 'Refresh and try again.'}`}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-gray-500">Loading...</div>
        ) : conversation ? (
          <>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              onPointerDown={() => setInputFocused(false)}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
            >
              {loadingOlder && (
                <div className="flex justify-center text-xs text-gray-500">Loading earlier messages...</div>
              )}
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
                        <div
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
                          {message.body && (
                            <p className="whitespace-pre-wrap break-words">
                              <RichText text={displayMessageBody(message.body)} />
                            </p>
                          )}
                          {message.media && (
                            <div
                              className="mt-1"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {message.media.kind === 'audio' ? (
                                <div className="space-y-2">
                                  <p className="text-xs text-gray-500">{mediaLabel(message.media)} · {formatBytes(message.media.size)}</p>
                                  <audio
                                    controls
                                    preload="none"
                                    src={mediaUrl(message)}
                                    className="w-[16rem] max-w-full"
                                  />
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openMedia(message)}
                                  className={`block max-w-full text-left ${message.is_mine ? 'text-primary' : 'text-gray-100'}`}
                                >
                                  <span className="inline-flex max-w-full items-center gap-2 border-b border-dark-border py-2">
                                    <span className="truncate">{mediaLabel(message.media)}</span>
                                    <span className="shrink-0 text-xs text-gray-500">{formatBytes(message.media.size)}</span>
                                  </span>
                                </button>
                              )}
                            </div>
                          )}
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
                        </div>
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
              <input ref={mediaInputRef} type="file" onChange={handleFileInput} className="hidden" />
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
              {!inputFocused && (
                <div className="flex shrink-0 items-center gap-4">
                  <button
                    type="button"
                    onClick={() => mediaInputRef.current?.click()}
                    disabled={mediaSending || recording}
                    className="text-sm font-medium text-gray-400 disabled:opacity-50"
                  >
                    Media
                  </button>
                  <button
                    type="button"
                    onClick={recording ? stopRecording : startRecording}
                    disabled={mediaSending}
                    className={`text-sm font-medium disabled:opacity-50 ${recording ? 'text-primary' : 'text-gray-400'}`}
                  >
                    {recording ? 'Stop' : 'Voice'}
                  </button>
                </div>
              )}
              <input
                type="text"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onFocus={() => setInputFocused(true)}
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

      {mediaPreview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4">
          <button
            type="button"
            aria-label="Close media"
            onClick={() => setMediaPreview(null)}
            className="absolute inset-0"
          />
          <div className="relative max-h-full w-full max-w-4xl bg-dark-bg p-3 shadow-2xl">
            <div className="mb-3 flex justify-end">
              <IconButton type="button" onClick={() => setMediaPreview(null)} icon="close" label="Close" />
            </div>
            {mediaPreview.message.media?.kind === 'video' ? (
              <video
                controls
                autoPlay
                src={mediaPreview.url}
                className="max-h-[78dvh] w-full bg-black object-contain p-1"
              />
            ) : (
              <img
                src={mediaPreview.url}
                alt={mediaPreview.message.media?.filename || 'Shared image'}
                className="max-h-[78dvh] w-full bg-black object-contain p-1"
              />
            )}
          </div>
        </div>
      )}

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
              <div className="border-t border-dark-border py-3">
                <p className="text-xs text-gray-500">Security</p>
                <p className={`mt-1 text-sm font-medium ${conversation.security?.status === 'changed' ? 'text-red-400' : conversation.security?.status === 'verified' ? 'text-primary' : 'text-gray-100'}`}>
                  {conversation.security?.status === 'changed'
                    ? 'Identity changed'
                    : conversation.security?.status === 'verified'
                    ? 'Verified'
                    : 'Unverified'}
                </p>
                {conversation.security?.status === 'changed' && (
                  <p className="mt-2 text-xs leading-5 text-red-300">
                    The saved identity for this conversation no longer matches the key now being presented. Confirm out of band before accepting this change.
                  </p>
                )}
                {conversation.security?.safety_number_display && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500">Safety number</p>
                    <p className="mt-1 break-words font-mono text-xs leading-5 text-gray-100">
                      {conversation.security.safety_number_display}
                    </p>
                  </div>
                )}
                {conversation.security?.remote_identity_fingerprint_display && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500">Remote identity fingerprint</p>
                    <p className="mt-1 break-words font-mono text-xs leading-5 text-gray-400">
                      {conversation.security.remote_identity_fingerprint_display}
                    </p>
                  </div>
                )}
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleMarkIdentityVerified}
                    disabled={securityUpdating === 'verify' || !conversation.security?.pin || conversation.security?.status === 'changed'}
                    className="text-left text-sm font-medium text-primary disabled:text-gray-600"
                  >
                    Mark as verified
                  </button>
                  {conversation.security?.status === 'changed' && (
                    <button
                      type="button"
                      onClick={handleAcceptIdentityChange}
                      disabled={securityUpdating === 'accept'}
                      className="text-left text-sm font-semibold text-red-300 disabled:text-gray-600"
                    >
                      Accept changed identity
                    </button>
                  )}
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
