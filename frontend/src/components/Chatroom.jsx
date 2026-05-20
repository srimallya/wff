import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/zustandStore'
import { IconButton } from './Icons'

const APP_TIME_ZONE = 'Asia/Kolkata'
const SERVER_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function parseTimestamp(value) {
  if (!value) return null
  const normalized = SERVER_TIMESTAMP_PATTERN.test(value) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
    ? `${value}Z`
    : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatTime(value) {
  const date = parseTimestamp(value)
  if (!date) return ''
  return date.toLocaleTimeString('bn-BD', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' })
}

export default function Chatroom() {
  const {
    chatroomMessages,
    chatroomLoading,
    chatroomError,
    fetchChatroom,
    sendChatroomMessage,
    joinChatroom,
  } = useStore()
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    fetchChatroom()
    joinChatroom()
  }, [fetchChatroom, joinChatroom])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: 'end' })
  }, [chatroomMessages.length])

  const handleSubmit = async (event) => {
    event.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    const clientNonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setBody('')
    setError('')
    const result = await sendChatroomMessage(trimmed, clientNonce)
    if (!result.success) setError(result.error)
  }

  return (
    <div className="flex h-[calc(100dvh-17rem)] min-h-[24rem] flex-col overflow-hidden border-t border-dark-border bg-transparent">
      <div className="shrink-0 border-b border-dark-border px-4 py-3">
        <h2 className="text-base font-medium text-gray-100">Chatroom</h2>
        <p className="mt-1 text-xs text-gray-500">Open room for registered users</p>
      </div>

      {(error || chatroomError) && (
        <div className="mx-4 mt-3 border-l border-primary pl-3 text-sm text-red-400">
          {error || chatroomError}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {chatroomLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading...</div>
        ) : chatroomMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">No messages yet</div>
        ) : (
          chatroomMessages.map((message) => (
            <div key={message.id} className={`flex ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] px-0 py-3 text-sm ${
                message.is_mine
                  ? 'text-primary'
                  : 'text-gray-100'
              }`}>
                {!message.is_mine && (
                  <p className="mb-1 truncate text-xs font-semibold text-primary">{message.sender_username}</p>
                )}
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <div className={`mt-1 flex justify-end gap-1 text-[11px] ${
                  message.is_mine ? 'text-white/75' : 'text-gray-500'
                }`}>
                  <span>{formatTime(message.created_at)}</span>
                  {message.sending_status === 'sending' && <span>…</span>}
                  {message.sending_status === 'failed' && <span>!</span>}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={scrollRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="sticky bottom-0 flex shrink-0 gap-5 border-t border-dark-border bg-dark-bg/95 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur"
      >
        <input
          type="text"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write in the chatroom..."
          maxLength={1000}
          className="min-w-0 flex-1 border-0 border-b px-0 py-3 text-sm focus:outline-none focus:border-primary"
        />
        <IconButton
          type="submit"
          disabled={!body.trim()}
          icon="send"
          label="Send"
          className="icon-button-primary"
        />
      </form>
    </div>
  )
}
