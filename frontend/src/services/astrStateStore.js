import { ASTR_VERIFY_CODES, ZERO_TRANSCRIPT_HASH } from './astrTranscript'

export const ASTR_DB_NAME = 'wff-astr-v4'
export const ASTR_DB_VERSION = 1
export const ASTR_STORES = [
  'identityKeys',
  'astrConversationState',
  'astrIdentityPins',
  'astrSessions',
  'astrSkippedKeys',
]

const DEVICE_ID_KEY = 'wff_astr_device_id'
const SAFETY_NUMBER_DOMAIN = 'wff:astr:safety-number:v1'
const encoder = new TextEncoder()
const memoryStores = new Map(ASTR_STORES.map((store) => [store, new Map()]))

function nowIso() {
  return new Date().toISOString()
}

export function currentAstrDeviceId() {
  let value = localStorage.getItem(DEVICE_ID_KEY)
  if (!value) {
    const random = crypto.getRandomValues(new Uint8Array(16))
    value = `dev_${[...random].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
    localStorage.setItem(DEVICE_ID_KEY, value)
  }
  return value
}

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined' && indexedDB?.open
}

async function openDb() {
  if (!hasIndexedDb()) return null
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASTR_DB_NAME, ASTR_DB_VERSION)
    request.onupgradeneeded = () => {
      ASTR_STORES.forEach((store) => {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store)
        }
      })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function astrStoreGet(storeName, key) {
  if (!hasIndexedDb()) return memoryStores.get(storeName)?.get(key) || null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

export async function astrStoreSet(storeName, key, value) {
  if (!hasIndexedDb()) {
    memoryStores.get(storeName)?.set(key, value)
    return
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export function astrStateKey(user, conversation, deviceId = currentAstrDeviceId()) {
  return `astr_state:${user.id || user.username}:${deviceId}:${conversation.id}`
}

function identityPinKey(localUserId, remoteUserId, remoteDeviceIdOrUser = 'user') {
  return `astr_identity_pin:${localUserId}:${remoteUserId}:${remoteDeviceIdOrUser || 'user'}`
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function publicKeyFingerprint(publicJwk) {
  if (!publicJwk || typeof publicJwk !== 'object') return null
  return sha256Hex(canonicalJson(publicJwk))
}

export function formatFingerprint(fingerprint, groupSize = 4) {
  if (!fingerprint) return ''
  return fingerprint.match(new RegExp(`.{1,${groupSize}}`, 'g'))?.join(' ') || fingerprint
}

export function safetyNumberDisplay(fingerprint) {
  if (!fingerprint) return ''
  return fingerprint.match(/.{1,5}/g)?.slice(0, 12).join(' ') || fingerprint
}

export async function computeSafetyNumber(localIdentityPublicKey, remoteIdentityPublicKey) {
  const local = canonicalJson(localIdentityPublicKey)
  const remote = canonicalJson(remoteIdentityPublicKey)
  const ordered = [local, remote].sort()
  return sha256Hex(`${SAFETY_NUMBER_DOMAIN}|${ordered[0]}|${ordered[1]}`)
}

export async function getIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser = 'user') {
  return astrStoreGet('astrIdentityPins', identityPinKey(localUserId, remoteUserId, remoteDeviceIdOrUser))
}

export async function saveIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser = 'user', pin) {
  const next = {
    remote_user_id: remoteUserId,
    remote_device_id_or_user: remoteDeviceIdOrUser || 'user',
    ...pin,
  }
  await astrStoreSet('astrIdentityPins', identityPinKey(localUserId, remoteUserId, remoteDeviceIdOrUser), next)
  return next
}

export async function markIdentityVerified(localUserId, remoteUserId, remoteDeviceIdOrUser = 'user') {
  const existing = await getIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser)
  if (!existing) return null
  return saveIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser, {
    ...existing,
    verified: true,
    changed: false,
    updated_at: nowIso(),
  })
}

export async function markIdentityChangeAccepted(localUserId, remoteUserId, remoteDeviceIdOrUser = 'user') {
  const existing = await getIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser)
  if (!existing) return null
  return saveIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser, {
    ...existing,
    identity_public_key_fingerprint: existing.current_fingerprint,
    signed_prekey_fingerprint: existing.current_signed_prekey_fingerprint || existing.signed_prekey_fingerprint,
    previous_fingerprint: existing.identity_public_key_fingerprint,
    verified: false,
    changed: false,
    updated_at: nowIso(),
  })
}

export async function detectIdentityChange({
  localUserId,
  remoteUserId,
  remoteDeviceIdOrUser = 'user',
  identityPublicKey,
  signedPrekeyPublicKey = null,
}) {
  const identityFingerprint = await publicKeyFingerprint(identityPublicKey)
  if (!identityFingerprint) return { pin: null, changed: false }
  const signedPrekeyFingerprint = await publicKeyFingerprint(signedPrekeyPublicKey || identityPublicKey)
  const existing = await getIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser)
  const now = nowIso()
  if (!existing) {
    const pin = await saveIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser, {
      identity_public_key_fingerprint: identityFingerprint,
      signed_prekey_fingerprint: signedPrekeyFingerprint,
      first_seen_at: now,
      last_seen_at: now,
      verified: false,
      changed: false,
      previous_fingerprint: null,
      current_fingerprint: identityFingerprint,
    })
    return { pin, changed: false, first_seen: true }
  }

  const changed = existing.identity_public_key_fingerprint !== identityFingerprint
  const next = await saveIdentityPin(localUserId, remoteUserId, remoteDeviceIdOrUser, {
    ...existing,
    signed_prekey_fingerprint: changed ? existing.signed_prekey_fingerprint : signedPrekeyFingerprint,
    current_signed_prekey_fingerprint: signedPrekeyFingerprint,
    last_seen_at: now,
    changed,
    previous_fingerprint: changed ? existing.identity_public_key_fingerprint : existing.previous_fingerprint,
    current_fingerprint: identityFingerprint,
  })
  return { pin: next, changed }
}

function lastVerifiedAstrMessage(messages) {
  return [...(messages || [])].reverse().find((message) =>
    message.astr?.transcript_hash && !message.verify_failed && !message.decrypt_failed
  ) || null
}

function lastSeenServerMessageId(messages) {
  const last = [...(messages || [])].reverse().find((message) => message.id != null)
  return last?.id || null
}

function stateFromVerification(conversation, user, verification, existing = null) {
  const now = nowIso()
  const lastVerified = lastVerifiedAstrMessage(verification.messages)
  return {
    version: 'astr-v4-client-state-aead',
    local_user_id: user.id || user.username,
    local_device_id: currentAstrDeviceId(),
    conversation_id: conversation.id,
    verified_transcript_hash: verification.verified_transcript_hash || ZERO_TRANSCRIPT_HASH,
    verified_counters: verification.verified_counters || { one_to_two: 0, two_to_one: 0 },
    structural_transcript_hash: verification.structural_transcript_hash || ZERO_TRANSCRIPT_HASH,
    structural_counters: verification.structural_counters || { one_to_two: 0, two_to_one: 0 },
    last_verified_message_id: lastVerified?.id || existing?.last_verified_message_id || null,
    last_seen_server_message_id: lastSeenServerMessageId(verification.messages),
    transcript_verified: verification.transcript_verified,
    transcript_error: verification.transcript_error,
    created_at: existing?.created_at || now,
    updated_at: now,
  }
}

function persistedPrefixMatches(existing, verification) {
  if (!existing?.last_verified_message_id) return true
  const matchingMessage = (verification.messages || []).find((message) =>
    String(message.id) === String(existing.last_verified_message_id)
  )
  return Boolean(
    matchingMessage
    && matchingMessage.verified_transcript_hash === existing.verified_transcript_hash
  )
}

export async function getAstrConversationState(conversation, user) {
  return astrStoreGet('astrConversationState', astrStateKey(user, conversation))
}

export async function saveAstrConversationState(conversation, user, state) {
  await astrStoreSet('astrConversationState', astrStateKey(user, conversation), state)
  return state
}

export async function reconcileAstrConversationState(conversation, user, verification) {
  const existing = await getAstrConversationState(conversation, user)
  if (existing && !persistedPrefixMatches(existing, verification)) {
    return {
      state: existing,
      secure_state_mismatch: true,
      transcript_verified: false,
      transcript_error: ASTR_VERIFY_CODES.SECURE_STATE_MISMATCH,
    }
  }

  const next = stateFromVerification(conversation, user, verification, existing)
  if (verification.transcript_verified || verification.transcript_error === ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING) {
    await saveAstrConversationState(conversation, user, next)
    return { state: next, secure_state_mismatch: false }
  }

  return { state: existing || next, secure_state_mismatch: false }
}

export function __resetAstrStateStoreForTests() {
  memoryStores.forEach((store) => store.clear())
  localStorage.removeItem(DEVICE_ID_KEY)
}
