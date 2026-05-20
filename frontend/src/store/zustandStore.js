import { create } from 'zustand'
import { io } from 'socket.io-client'
import { API_BASE } from '../api'
import { AstrClientError, createAstrPacket, decryptConversation, ensureKeyBundleRegistered } from '../services/astrClient'

const socketPath = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/socket.io`
const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin
let socket = null

function normalizeUser(d) {
  return {
    username: d.username || null,
    id: d.id || d.user_id || null,
    birthdate: d.birthdate || null,
    isBengali: d.is_bengali ?? d.isBengali ?? false,
    isGuest: d.is_guest ?? d.isGuest ?? false,
    canPost: d.can_post ?? d.canPost ?? false,
    realUsername: d.real_username ?? d.realUsername ?? null,
  }
}

function calculateAge(birthdate) {
  if (!birthdate) return null
  const date = new Date(birthdate)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - date.getFullYear()
  if (now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())) {
    age -= 1
  }
  return age
}

function uniqueById(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = String(item.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const useStore = create((set, get) => ({
  user: {
    username: localStorage.getItem('wff_username') || null,
    id: localStorage.getItem('wff_id') || null,
    birthdate: localStorage.getItem('wff_birthdate') || null,
    isBengali: localStorage.getItem('wff_isBengali') === 'true',
    isGuest: localStorage.getItem('wff_isGuest') === 'true',
    canPost: localStorage.getItem('wff_canPost') === 'true',
    realUsername: localStorage.getItem('wff_realUsername') || null,
  },

  feedFilter: { year: null, active: false, countryCode: '' },
  essays: [],
  feedTimelineEssays: [],
  essaysTotal: 0,
  feedYearCounts: [],
  feedYearCountsLoading: false,
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  searchError: null,
  messageSearchResults: [],
  messagesHome: { pendingOutgoing: [], pendingIncoming: [], threads: [] },
  chatroomMessages: [],
  chatroomLoading: false,
  chatroomError: null,
  messagesLoading: false,
  messagesError: null,
  realtimeConnected: false,
  lastRealtimeEvent: null,

  setUser: (userData) => {
    const clean = normalizeUser(userData)
    Object.entries(clean).forEach(([k, v]) => {
      localStorage.setItem(`wff_${k}`, v === null ? '' : String(v))
    })
    set({ user: clean })
  },

  clearUser: () => {
    [
      'username', 'id', 'birthdate', 'isBengali', 'isGuest',
      'canPost', 'realUsername'
    ].forEach(k => localStorage.removeItem(`wff_${k}`))
    set({ user: { username: null, id: null, birthdate: null, isBengali: false, isGuest: false, canPost: false, realUsername: null }, essays: [] })
    if (socket) socket.disconnect()
    socket = null
  },

  initRealtime: () => {
    const { user } = get()
    if (!user.username || socket) return
    socket = io(socketUrl, {
      path: socketPath,
      transports: ['polling', 'websocket'],
    })
    socket.on('connect', () => {
      set({ realtimeConnected: true })
      socket.emit('wff_join', { username: user.username })
    })
    socket.on('disconnect', () => set({ realtimeConnected: false }))
    socket.on('message_created', (payload) => {
      const thread = payload.thread
      if (thread) {
        set((state) => ({
          messagesHome: {
            ...state.messagesHome,
            threads: uniqueById([thread, ...state.messagesHome.threads.filter((item) => item.id !== thread.id)]),
          },
        }))
      }
      set({ lastRealtimeEvent: { type: 'message_created', payload, receivedAt: Date.now() } })
    })
    socket.on('request_created', (payload) => {
      const request = payload.request
      if (!request) return
      set((state) => {
        const key = request.direction === 'incoming' ? 'pendingIncoming' : 'pendingOutgoing'
        return {
          messagesHome: {
            ...state.messagesHome,
            [key]: uniqueById([request, ...state.messagesHome[key].filter((item) => item.id !== request.id)]),
          },
          lastRealtimeEvent: { type: 'request_created', payload, receivedAt: Date.now() },
        }
      })
    })
    socket.on('request_accepted', (payload) => {
      const conversation = payload.conversation
      const requestId = payload.request_id
      set((state) => ({
        messagesHome: {
          pendingOutgoing: state.messagesHome.pendingOutgoing.filter((item) => item.id !== requestId),
          pendingIncoming: state.messagesHome.pendingIncoming.filter((item) => item.id !== requestId),
          threads: conversation
            ? uniqueById([conversation, ...state.messagesHome.threads.filter((item) => item.id !== conversation.id)])
            : state.messagesHome.threads,
        },
        lastRealtimeEvent: { type: 'request_accepted', payload, receivedAt: Date.now() },
      }))
    })
    socket.on('request_deleted', (payload) => {
      const requestId = payload.request_id
      set((state) => ({
        messagesHome: {
          ...state.messagesHome,
          pendingOutgoing: state.messagesHome.pendingOutgoing.filter((item) => item.id !== requestId),
          pendingIncoming: state.messagesHome.pendingIncoming.filter((item) => item.id !== requestId),
        },
        lastRealtimeEvent: { type: 'request_deleted', payload, receivedAt: Date.now() },
      }))
    })
    socket.on('thread_removed', (payload) => {
      const conversationId = payload.conversation_id
      set((state) => ({
        messagesHome: {
          ...state.messagesHome,
          threads: state.messagesHome.threads.filter((item) => String(item.id) !== String(conversationId)),
        },
        lastRealtimeEvent: { type: 'thread_removed', payload, receivedAt: Date.now() },
      }))
    })
    socket.on('chatroom_message_created', (payload) => {
      const message = payload.message
      if (!message) return
      set((state) => ({
        chatroomMessages: uniqueById(
          state.chatroomMessages
            .map((item) => item.client_nonce && item.client_nonce === message.client_nonce
              ? { ...message, is_mine: String(message.sender_username) === String(state.user.username), sending_status: 'sent' }
              : item
            )
            .concat(
              state.chatroomMessages.some((item) => item.client_nonce && item.client_nonce === message.client_nonce)
                ? []
                : [{ ...message, is_mine: String(message.sender_username) === String(state.user.username) }]
            )
        ),
        lastRealtimeEvent: { type: 'chatroom_message_created', payload, receivedAt: Date.now() },
      }))
    })
    socket.on('essay_created', (payload) => {
      const essay = payload.essay
      if (!essay) return
      set((state) => {
        const replacePending = (items) => {
          const pendingIndex = items.findIndex((item) =>
            item.is_pending && item.username === essay.username && item.content === essay.content
          )
          if (pendingIndex >= 0) {
            return uniqueById(items.map((item, index) => index === pendingIndex ? essay : item))
          }
          return uniqueById([essay, ...items])
        }
        const alreadyPresent = state.essays.some((item) => item.id === essay.id)
        const replacesPending = state.essays.some((item) =>
          item.is_pending && item.username === essay.username && item.content === essay.content
        )
        return {
          essays: replacePending(state.essays),
          feedTimelineEssays: replacePending(state.feedTimelineEssays),
          essaysTotal: state.essaysTotal + (!alreadyPresent && !replacesPending ? 1 : 0),
        }
      })
    })
  },

  joinConversation: (conversationId) => {
    if (socket?.connected) socket.emit('wff_join_conversation', { conversation_id: Number(conversationId) })
  },

  joinChatroom: () => {
    const { user } = get()
    if (socket?.connected && user.username) socket.emit('wff_join_chatroom', { username: user.username })
  },

  setFeedYear: (year) => set((s) => ({ feedFilter: { ...s.feedFilter, year, active: true } })),
  setFeedCountry: (countryCode) => set((s) => ({ feedFilter: { ...s.feedFilter, countryCode } })),
  clearFeedFilter: () => set((s) => ({ feedFilter: { ...s.feedFilter, year: null, active: false } })),
  resetFeedView: () => set({
    feedFilter: { year: null, active: false, countryCode: '' },
    searchQuery: '',
    searchResults: [],
    isSearching: false,
    searchError: null,
  }),

  register: async (data) => {
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const d = await res.json()
      if (res.ok) {
        get().setUser(d)
        if (d.can_post && !d.is_guest) await ensureKeyBundleRegistered(normalizeUser(d))
        return { success: true, data: d }
      }
      return { success: false, error: d.error }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  login: async (real_username, password) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ real_username, password }),
      })
      const d = await res.json()
      if (res.ok) {
        get().setUser(d)
        if (d.can_post && !d.is_guest) await ensureKeyBundleRegistered(normalizeUser(d))
        return { success: true, data: d }
      }
      return { success: false, error: d.error }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  initGuest: async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/init-guest`, { method: 'POST' })
      const d = await res.json()
      get().setUser(d)
      return d
    } catch (e) {
      console.error(e)
      return null
    }
  },

  fetchUser: async (username) => {
    try {
      const res = await fetch(`${API_BASE}/auth/me/${username}`)
      const d = await res.json()
      if (res.ok) {
        get().setUser(d)
        if (d.can_post && !d.is_guest) await ensureKeyBundleRegistered(normalizeUser(d))
      }
      return d
    } catch (e) { return null }
  },

  deleteAccount: async (real_username, password, username) => {
    try {
      const res = await fetch(`${API_BASE}/auth/delete-account`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ real_username, password, username }),
      })
      const d = await res.json()
      if (res.ok) get().clearUser()
      return { success: res.ok, error: d.error }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  fetchEssays: async () => {
    const { feedFilter, user } = get()
    let url = `${API_BASE}/essays?`
    if (feedFilter.active && feedFilter.year != null) url += `year=${feedFilter.year}&`
    if (feedFilter.countryCode) url += `country_code=${encodeURIComponent(feedFilter.countryCode)}&`
    if (user.id) url += `current_user_id=${user.id}`
    try {
      const res = await fetch(url)
      const d = await res.json()
      if (res.ok) {
        const nextEssays = d.essays || []
        set({
          essays: nextEssays,
          essaysTotal: d.total || 0,
          ...(!feedFilter.active ? { feedTimelineEssays: nextEssays } : {}),
        })
      }
    } catch (e) { console.error(e) }
  },

  fetchFeedYearCounts: async () => {
    const currentYear = new Date().getFullYear()
    set({ feedYearCountsLoading: true })
    try {
      const res = await fetch(`${API_BASE}/essays/year-counts?start_year=${currentYear}&end_year=${currentYear + 100}`)
      const d = await res.json()
      set({ feedYearCounts: d.counts || [], feedYearCountsLoading: false })
    } catch (e) {
      console.error(e)
      set({ feedYearCounts: [], feedYearCountsLoading: false })
    }
  },

  fetchUserEssays: async (username) => {
    let url = `${API_BASE}/essays?username=${encodeURIComponent(username)}`
    try {
      const res = await fetch(url)
      const d = await res.json()
      return d.essays || []
    } catch (e) { console.error(e); return [] }
  },

  createEssay: async (essayData) => {
    const { user } = get()
    const now = new Date()
    const yearsAhead = Math.floor(essayData.look_ahead_months / 12)
    const currentAge = calculateAge(user.birthdate)
    const tempId = `pending-${Date.now()}`
    const optimisticEssay = {
      id: tempId,
      username: user.username,
      content: essayData.content,
      country: essayData.country || 'Global',
      country_code: essayData.country_code || 'GLOBAL',
      look_ahead_months: essayData.look_ahead_months,
      target_calendar_year: now.getFullYear() + yearsAhead,
      author_current_age: currentAge,
      target_age: currentAge == null ? null : currentAge + yearsAhead,
      created_at: now.toISOString(),
      is_policy_proposal: essayData.is_policy_proposal || false,
      upvotes: 0,
      downvotes: 0,
      score: 0,
      user_vote: null,
      is_pending: true,
    }
    set((state) => ({
      essays: [optimisticEssay, ...state.essays],
      feedTimelineEssays: [optimisticEssay, ...state.feedTimelineEssays],
      essaysTotal: state.essaysTotal + 1,
    }))
    try {
      const res = await fetch(`${API_BASE}/essays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...essayData, username: user.username }),
      })
      const d = await res.json()
      if (res.ok) {
        set((state) => ({
          essays: uniqueById(state.essays.map((essay) => essay.id === tempId ? d : essay)),
          feedTimelineEssays: uniqueById(state.feedTimelineEssays.map((essay) => essay.id === tempId ? d : essay)),
        }))
      } else {
        set((state) => ({
          essays: state.essays.filter((essay) => essay.id !== tempId),
          feedTimelineEssays: state.feedTimelineEssays.filter((essay) => essay.id !== tempId),
          essaysTotal: Math.max(0, state.essaysTotal - 1),
          searchError: d.error || 'Post failed',
        }))
      }
      return d
    } catch (e) {
      console.error(e)
      set((state) => ({
        essays: state.essays.filter((essay) => essay.id !== tempId),
        feedTimelineEssays: state.feedTimelineEssays.filter((essay) => essay.id !== tempId),
        essaysTotal: Math.max(0, state.essaysTotal - 1),
        searchError: 'Network error',
      }))
      return null
    }
  },

  voteEssay: async (essayId, value) => {
    const { user } = get()
    if (!user.username) return null
    try {
      const res = await fetch(`${API_BASE}/essays/${essayId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, value }),
      })
      return await res.json()
    } catch (e) { console.error(e); return null }
  },

  searchEssays: async (query) => {
    if (!query || !query.trim()) {
      set({ searchQuery: '', searchResults: [], isSearching: false, searchError: null })
      return
    }
    const { user } = get()
    set({ searchQuery: query.trim(), isSearching: true, searchError: null })
    try {
      const res = await fetch(`${API_BASE}/essays/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), current_user_id: user.id || undefined }),
      })
      const d = await res.json()
      if (res.ok) {
        set({ searchResults: d.essays || [], isSearching: false, essaysTotal: d.total || 0 })
      } else {
        set({ searchResults: [], isSearching: false, searchError: d.error || 'Search failed' })
      }
    } catch (e) {
      set({ searchResults: [], isSearching: false, searchError: 'Network error' })
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [], isSearching: false, searchError: null }),

  searchMessageUsers: async (query) => {
    const { user } = get()
    if (!user.username || !query || query.trim().length < 2) {
      set({ messageSearchResults: [] })
      return []
    }
    try {
      const params = new URLSearchParams({ username: user.username, q: query.trim() })
      const res = await fetch(`${API_BASE}/messages/users/search?${params.toString()}`)
      const d = await res.json()
      const results = res.ok ? (d.users || []) : []
      set({ messageSearchResults: results })
      return results
    } catch (e) {
      set({ messageSearchResults: [] })
      return []
    }
  },

  clearMessageSearch: () => set({ messageSearchResults: [] }),

  fetchMessagesHome: async () => {
    const { user } = get()
    if (!user.username) return null
    set({ messagesLoading: true, messagesError: null })
    try {
      const params = new URLSearchParams({ username: user.username })
      const res = await fetch(`${API_BASE}/messages?${params.toString()}`)
      const d = await res.json()
      if (res.ok) {
        const home = {
          pendingOutgoing: d.pending_outgoing || [],
          pendingIncoming: d.pending_incoming || [],
          threads: d.threads || [],
        }
        set({ messagesHome: home, messagesLoading: false })
        return home
      }
      set({ messagesError: d.error || 'Messages could not be loaded', messagesLoading: false })
      return null
    } catch (e) {
      set({ messagesError: 'Network error', messagesLoading: false })
      return null
    }
  },

  createMessageRequest: async (receiverUsername, note = '') => {
    const { user } = get()
    try {
      const res = await fetch(`${API_BASE}/messages/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, receiver_username: receiverUsername, note }),
      })
      const d = await res.json()
      if (res.ok) {
        await get().fetchMessagesHome()
        return { success: true, data: d }
      }
      return { success: false, error: d.error || 'Request could not be sent' }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  acceptMessageRequest: async (requestId) => {
    const { user } = get()
    try {
      const res = await fetch(`${API_BASE}/messages/requests/${requestId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username }),
      })
      const d = await res.json()
      if (res.ok) {
        await get().fetchMessagesHome()
        return { success: true, conversation: d.conversation }
      }
      return { success: false, error: d.error || 'Request could not be accepted' }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  deleteMessageRequest: async (requestId) => {
    const { user } = get()
    try {
      const res = await fetch(`${API_BASE}/messages/requests/${requestId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username }),
      })
      const d = await res.json()
      if (res.ok) {
        await get().fetchMessagesHome()
        return { success: true }
      }
      return { success: false, error: d.error || 'Request could not be deleted' }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  fetchConversation: async (conversationId) => {
    const { user } = get()
    try {
      const params = new URLSearchParams({ username: user.username })
      const res = await fetch(`${API_BASE}/messages/threads/${conversationId}?${params.toString()}`)
      const d = await res.json()
      if (res.ok) return { success: true, conversation: await decryptConversation(d.conversation, user) }
      return { success: false, error: d.error || 'Conversation not found' }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  sendConversationMessage: async (conversationId, body, clientNonce, conversation = null) => {
    const { user } = get()
    try {
      let sendConversation = conversation
      let astrPacket = null
      if (sendConversation) {
        try {
          astrPacket = await createAstrPacket(sendConversation, user, body)
        } catch (e) {
          if (e?.code !== 'REMOTE_KEY_MISSING') throw e
          const params = new URLSearchParams({ username: user.username })
          const refreshRes = await fetch(`${API_BASE}/messages/threads/${conversationId}?${params.toString()}`)
          const refreshData = await refreshRes.json()
          if (!refreshRes.ok) throw e
          sendConversation = await decryptConversation(refreshData.conversation, user)
          astrPacket = await createAstrPacket(sendConversation, user, body)
        }
      }
      if (conversation && !astrPacket) return { success: false, error: 'Secure session could not be created' }
      const res = await fetch(`${API_BASE}/messages/threads/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          body: astrPacket ? '' : body,
          client_nonce: clientNonce,
          astr_packet: astrPacket,
        }),
      })
      const d = await res.json()
      if (res.ok) {
        const decrypted = sendConversation ? await decryptConversation({ ...sendConversation, messages: [d.message] }, user) : { messages: [d.message] }
        return { success: true, message: decrypted.messages[0] }
      }
      return { success: false, error: d.error || 'Message could not be sent' }
    } catch (e) {
      if (e?.code === 'REMOTE_KEY_MISSING') {
        return { success: false, error: 'The other user has not created secure keys yet. Ask them to open the app once.' }
      }
      if (e?.code === 'LOCAL_KEY_REGISTRATION_FAILED') {
        return { success: false, error: 'Your secure key could not be uploaded. Try again.' }
      }
      if (e instanceof AstrClientError) {
        return { success: false, error: 'Secure session could not be created' }
      }
      return { success: false, error: 'Network error' }
    }
  },

  closeConversation: async (conversationId, action = 'delete') => {
    const { user } = get()
    const path = action === 'block'
      ? `${API_BASE}/messages/threads/${conversationId}/block`
      : action === 'unfriend'
      ? `${API_BASE}/messages/threads/${conversationId}/unfriend`
      : `${API_BASE}/messages/threads/${conversationId}`
    const method = action === 'delete' ? 'DELETE' : 'POST'
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username }),
      })
      const d = await res.json()
      if (res.ok) {
        set((state) => ({
          messagesHome: {
            ...state.messagesHome,
            threads: state.messagesHome.threads.filter((item) => String(item.id) !== String(conversationId)),
          },
        }))
        return { success: true, data: d }
      }
      return { success: false, error: d.error || 'Conversation could not be updated' }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  fetchChatroom: async () => {
    const { user } = get()
    if (!user.username) return null
    set({ chatroomLoading: true, chatroomError: null })
    try {
      const params = new URLSearchParams({ username: user.username })
      const res = await fetch(`${API_BASE}/messages/chatroom?${params.toString()}`)
      const d = await res.json()
      if (res.ok) {
        set({ chatroomMessages: d.messages || [], chatroomLoading: false })
        return d.messages || []
      }
      set({ chatroomError: d.error || 'Chatroom could not be loaded', chatroomLoading: false })
      return null
    } catch (e) {
      set({ chatroomError: 'Network error', chatroomLoading: false })
      return null
    }
  },

  sendChatroomMessage: async (body, clientNonce) => {
    const { user } = get()
    try {
      const optimisticMessage = {
        id: `pending-${clientNonce}`,
        sender_username: user.username,
        body,
        created_at: new Date().toISOString(),
        is_mine: true,
        client_nonce: clientNonce,
        sending_status: 'sending',
      }
      set((state) => ({ chatroomMessages: [...state.chatroomMessages, optimisticMessage] }))
      const res = await fetch(`${API_BASE}/messages/chatroom/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, body, client_nonce: clientNonce }),
      })
      const d = await res.json()
      if (res.ok) {
        set((state) => ({
          chatroomMessages: uniqueById(state.chatroomMessages.map((message) =>
            message.client_nonce === clientNonce ? { ...d.message, sending_status: 'sent' } : message
          )),
        }))
        return { success: true, message: d.message }
      }
      set((state) => ({
        chatroomMessages: state.chatroomMessages.map((message) =>
          message.client_nonce === clientNonce ? { ...message, sending_status: 'failed' } : message
        ),
      }))
      return { success: false, error: d.error || 'Message could not be sent' }
    } catch (e) {
      set((state) => ({
        chatroomMessages: state.chatroomMessages.map((message) =>
          message.client_nonce === clientNonce ? { ...message, sending_status: 'failed' } : message
        ),
      }))
      return { success: false, error: 'Network error' }
    }
  },

  fetchNotificationKey: async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications/vapid-public-key`)
      const d = await res.json()
      return { success: res.ok, configured: d.configured, publicKey: d.public_key }
    } catch (e) {
      return { success: false, configured: false, publicKey: null }
    }
  },

  savePushSubscription: async (subscription) => {
    const { user } = get()
    try {
      const res = await fetch(`${API_BASE}/notifications/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, subscription }),
      })
      const d = await res.json()
      return { success: res.ok, configured: d.configured, error: d.error }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },

  deletePushSubscription: async (endpoint) => {
    const { user } = get()
    try {
      const res = await fetch(`${API_BASE}/notifications/subscriptions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, endpoint }),
      })
      const d = await res.json()
      return { success: res.ok, error: d.error }
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  },
}))
