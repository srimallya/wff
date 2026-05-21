import { API_BASE } from '../api'

const ASTR_V2 = 'astr-v2-client-aead'
const ASTR_V3 = 'astr-v3-ratchet-aead'
const ASTR_V4 = 'astr-v4-client-state-aead'
const ZERO_TRANSCRIPT_HASH = 'a963b6e50f6e18cf00efbdbd0303644e82b0121b10092b623153b3d97259d7c5'
const DB_NAME = 'wff-astr-v3'
const KEY_STORE = 'identityKeys'
const DEVICE_ID_KEY = 'wff_astr_device_id'
const ENVELOPE_CIPHERTEXT_TYPE = 'astr-v3-device-envelopes'
const ENVELOPE_CIPHERTEXT_TYPE_V4 = 'astr-v4-device-envelopes'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class AstrClientError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AstrClientError'
    this.code = code
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function bytesToBase64(bytes) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function concatBytes(...items) {
  const total = items.reduce((sum, item) => sum + item.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  items.forEach((item) => {
    out.set(item, offset)
    offset += item.length
  })
  return out
}

async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KEY_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbGet(key) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbSet(key, value) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function generateIdentity() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  )
}

function currentDeviceId() {
  let value = localStorage.getItem(DEVICE_ID_KEY)
  if (!value) {
    const random = crypto.getRandomValues(new Uint8Array(16))
    value = `dev_${[...random].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
    localStorage.setItem(DEVICE_ID_KEY, value)
  }
  return value
}

async function identityFor(user) {
  const storageKey = `identity:${user.id || user.username}:${currentDeviceId()}`
  let pair = await idbGet(storageKey)
  if (!pair) {
    pair = await generateIdentity()
    await idbSet(storageKey, pair)
  }
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { pair, publicJwk }
}

export async function ensureKeyBundleRegistered(user) {
  if (!crypto?.subtle || !indexedDB || !user?.username) return null
  const { publicJwk } = await identityFor(user)
  const res = await fetch(`${API_BASE}/messages/key-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: user.username,
      device_id: currentDeviceId(),
      identity_public_key: publicJwk,
      signed_prekey_public_key: publicJwk,
      signed_prekey_signature: await sha256Hex(canonical(publicJwk)),
    }),
  })
  if (!res.ok) throw new AstrClientError('LOCAL_KEY_REGISTRATION_FAILED', 'Local key registration failed')
  return publicJwk
}

function directionFor(conversation, userId) {
  return Number(userId) === Number(conversation.participants?.one?.id) ? 'one_to_two' : 'two_to_one'
}

function remoteUserId(conversation, userId) {
  return Number(userId) === Number(conversation.participants?.one?.id)
    ? conversation.participants?.two?.id
    : conversation.participants?.one?.id
}

function lastTranscriptHash(messages) {
  const astrMessages = (messages || []).filter((message) => message.astr?.transcript_hash)
  return astrMessages.length ? astrMessages[astrMessages.length - 1].astr.transcript_hash : ZERO_TRANSCRIPT_HASH
}

function nextCounter(messages, direction) {
  return (messages || []).filter((message) =>
    [ASTR_V2, ASTR_V3, ASTR_V4].includes(message.astr?.version) && message.astr?.direction === direction
  ).length
}

async function importRemotePublicKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
}

function packetRatchetPayload(value) {
  if (!value || typeof value !== 'string') return { ratchet_public_key: value || '' }
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') return parsed
  } catch (e) {
    // Older packets stored the ratchet key as a plain string.
  }
  return { ratchet_public_key: value }
}

function packetStateCommitment(message) {
  return message.astr?.sender_state_commitment || message.astr?.ratchet_public_key || ''
}

function packetRatchetString(payload) {
  return canonical(payload)
}

function validDevicePublicKey(jwk) {
  return jwk && typeof jwk === 'object' && jwk.kty === 'EC'
}

function devicesForBundle(bundle) {
  const devices = []
  ;(bundle?.devices || []).forEach((device) => {
    const jwk = device.signed_prekey_public_key || device.identity_public_key
    if (device.device_id && validDevicePublicKey(jwk)) {
      devices.push({
        device_id: device.device_id,
        public_key: jwk,
      })
    }
  })
  const legacyJwk = bundle?.signed_prekey_public_key || bundle?.identity_public_key
  if (!devices.length && validDevicePublicKey(legacyJwk)) {
    devices.push({
      device_id: 'legacy',
      public_key: legacyJwk,
    })
  }
  return devices
}

async function sharedSecret(conversation, user, remotePublicJwk = null) {
  const { pair } = await identityFor(user)
  const remoteId = remoteUserId(conversation, user.id)
  const remoteBundle = conversation.key_bundles?.[String(remoteId)]
  const remoteJwk = remotePublicJwk || remoteBundle?.signed_prekey_public_key || remoteBundle?.identity_public_key
  if (!remoteJwk) throw new AstrClientError('REMOTE_KEY_MISSING', 'Remote key missing')
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: await importRemotePublicKey(remoteJwk) },
    pair.privateKey,
    256
  )
  return new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    concatBytes(new Uint8Array(bits), encoder.encode(`wff:astr:v3:${conversation.id}`))
  ))
}

async function hmacBytes(keyBytes, label) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(label)))
}

async function hmacHex(keyBytes, label) {
  return [...await hmacBytes(keyBytes, label)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function aesKeyFromBytes(keyBytes) {
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function v3RootKey(conversation, user, remotePublicJwk = null) {
  return hmacBytes(await sharedSecret(conversation, user, remotePublicJwk), `root:${conversation.id}:epoch:${conversation.channel?.epoch || 1}`)
}

async function v3MessageKey(conversation, user, direction, counter, remotePublicJwk = null) {
  const root = await v3RootKey(conversation, user, remotePublicJwk)
  const chainKey = await hmacBytes(root, `chain:${direction}`)
  return hmacBytes(chainKey, `message:${counter}`)
}

async function v3MessageKeyForPublicKey(conversation, user, direction, counter, publicJwk) {
  return v3MessageKey(conversation, user, direction, counter, publicJwk)
}

function associatedDataV3(packet) {
  return encoder.encode(canonical({
    channel_hint: packet.channel_hint,
    counter: packet.counter,
    direction: packet.direction,
    epoch: packet.epoch,
    prev_transcript_hash: packet.prev_transcript_hash,
    previous_chain_length: packet.previous_chain_length,
    ratchet_public_key: packet.ratchet_public_key,
    version: packet.version,
  }))
}

function associatedDataV4(packet) {
  return encoder.encode(canonical({
    channel_hint: packet.channel_hint,
    counter: packet.counter,
    direction: packet.direction,
    epoch: packet.epoch,
    prev_transcript_hash: packet.prev_transcript_hash,
    previous_chain_length: packet.previous_chain_length,
    sender_state_commitment: packet.sender_state_commitment,
    version: packet.version,
  }))
}

function associatedDataV2(direction, counter, prevTranscriptHash) {
  return encoder.encode(canonical({
    counter,
    direction,
    prev_transcript_hash: prevTranscriptHash,
  }))
}

async function v2KeyBytes(conversation) {
  const one = conversation.participants?.one?.id
  const two = conversation.participants?.two?.id
  return crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`wff:astr:v2:${conversation.id}:${Math.min(one, two)}:${Math.max(one, two)}`)
  )
}

async function v2AesKey(conversation) {
  return crypto.subtle.importKey('raw', await v2KeyBytes(conversation), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function v2HmacHex(conversation, packet) {
  const key = await crypto.subtle.importKey('raw', await v2KeyBytes(conversation), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(canonical(packet)))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createAstrPacket(conversation, user, plaintext) {
  if (!crypto?.subtle || !conversation?.participants?.one || !conversation?.participants?.two) return null
  await ensureKeyBundleRegistered(user)
  const { publicJwk } = await identityFor(user)
  const userId = String(user.id)
  const remoteId = String(remoteUserId(conversation, user.id))
  const remoteTargets = devicesForBundle(conversation.key_bundles?.[remoteId]).map((device) => ({ ...device, user_id: remoteId }))
  if (!remoteTargets.length) throw new AstrClientError('REMOTE_KEY_MISSING', 'Remote key missing')
  const deviceTargets = [
    ...remoteTargets,
    { user_id: userId, device_id: currentDeviceId(), public_key: publicJwk },
    ...devicesForBundle(conversation.key_bundles?.[userId]).map((device) => ({ ...device, user_id: userId })),
  ]
  const uniqueTargets = []
  const seenTargets = new Set()
  deviceTargets.forEach((target) => {
    const key = `${target.user_id}:${target.device_id}`
    if (seenTargets.has(key)) return
    seenTargets.add(key)
    uniqueTargets.push(target)
  })
  const direction = directionFor(conversation, user.id)
  const counter = Number.isInteger(conversation.channel?.counters?.[direction])
    ? conversation.channel.counters[direction]
    : nextCounter(conversation.messages, direction)
  const prevTranscriptHash = conversation.channel?.transcript_hash || lastTranscriptHash(conversation.messages)
  const root = await v3RootKey(conversation, user)
  const senderStateCommitment = packetRatchetString({
    sender_state_commitment: await hmacHex(root, `sender-state:${direction}:${counter}`),
    sender_identity_public_key: publicJwk,
  })
  const packet = {
    version: ASTR_V4,
    channel_hint: `conversation:${conversation.id}`,
    epoch: conversation.channel?.epoch || 1,
    direction,
    counter,
    previous_chain_length: conversation.channel?.previous_chain_lengths?.[direction] || 0,
    sender_state_commitment: senderStateCommitment,
    prev_transcript_hash: prevTranscriptHash,
  }
  const envelopes = []
  for (const target of uniqueTargets) {
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const messageKey = await v3MessageKeyForPublicKey(conversation, user, direction, counter, target.public_key)
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: associatedDataV4(packet) },
      await aesKeyFromBytes(messageKey),
      encoder.encode(plaintext)
    ))
    envelopes.push({
      user_id: target.user_id,
      device_id: target.device_id,
      ciphertext: bytesToBase64(concatBytes(nonce, encrypted)),
    })
  }
  packet.ciphertext = JSON.stringify({
    type: ENVELOPE_CIPHERTEXT_TYPE_V4,
    envelopes,
  })
  const authTag = await hmacHex(root, canonical(packet))
  const transcriptHash = await sha256Hex(`${prevTranscriptHash}|${direction}|${counter}|${senderStateCommitment}|${packet.ciphertext}|${authTag}`)
  return {
    ...packet,
    auth_tag: authTag,
    transcript_hash: transcriptHash,
  }
}

async function decryptV3(conversation, user, message) {
  const ratchetPayload = packetRatchetPayload(message.astr.ratchet_public_key)
  const senderPublicKey = ratchetPayload.sender_identity_public_key
  const packet = {
    version: message.astr.version,
    channel_hint: `conversation:${conversation.id}`,
    epoch: message.astr.epoch || conversation.channel?.epoch || 1,
    direction: message.astr.direction,
    counter: message.astr.counter,
    previous_chain_length: message.astr.previous_chain_length || 0,
    ratchet_public_key: message.astr.ratchet_public_key,
    prev_transcript_hash: message.astr.prev_transcript_hash,
  }
  let encryptedCiphertext = message.astr.ciphertext
  let envelopeMode = false
  try {
    const parsed = JSON.parse(message.astr.ciphertext)
    if ([ENVELOPE_CIPHERTEXT_TYPE, ENVELOPE_CIPHERTEXT_TYPE_V4].includes(parsed?.type) && Array.isArray(parsed.envelopes)) {
      envelopeMode = true
      const deviceId = currentDeviceId()
      const envelope = parsed.envelopes.find((item) =>
        String(item.user_id) === String(user.id) && item.device_id === deviceId
      )
      if (!envelope) throw new AstrClientError('DEVICE_ENVELOPE_MISSING', 'Message was not encrypted for this device')
      encryptedCiphertext = envelope.ciphertext
    }
  } catch (e) {
    if (e instanceof AstrClientError) throw e
  }
  const payload = base64ToBytes(encryptedCiphertext)
  const nonce = payload.slice(0, 12)
  const ciphertext = payload.slice(12)
  const messageKey = envelopeMode
    ? await v3MessageKey(conversation, user, message.astr.direction, message.astr.counter, senderPublicKey)
    : await v3MessageKey(conversation, user, message.astr.direction, message.astr.counter, message.is_mine ? null : senderPublicKey)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: associatedDataV3(packet) },
    await aesKeyFromBytes(messageKey),
    ciphertext
  )
  return { ...message, body: decoder.decode(plaintext), encrypted: true }
}

async function decryptV4(conversation, user, message) {
  const senderStateCommitment = packetStateCommitment(message)
  const statePayload = packetRatchetPayload(senderStateCommitment)
  const senderPublicKey = statePayload.sender_identity_public_key
  const packet = {
    version: message.astr.version,
    channel_hint: `conversation:${conversation.id}`,
    epoch: message.astr.epoch || conversation.channel?.epoch || 1,
    direction: message.astr.direction,
    counter: message.astr.counter,
    previous_chain_length: message.astr.previous_chain_length || 0,
    sender_state_commitment: senderStateCommitment,
    prev_transcript_hash: message.astr.prev_transcript_hash,
  }
  let encryptedCiphertext = message.astr.ciphertext
  let envelopeMode = false
  try {
    const parsed = JSON.parse(message.astr.ciphertext)
    if ([ENVELOPE_CIPHERTEXT_TYPE, ENVELOPE_CIPHERTEXT_TYPE_V4].includes(parsed?.type) && Array.isArray(parsed.envelopes)) {
      envelopeMode = true
      const deviceId = currentDeviceId()
      const envelope = parsed.envelopes.find((item) =>
        String(item.user_id) === String(user.id) && item.device_id === deviceId
      )
      if (!envelope) throw new AstrClientError('DEVICE_ENVELOPE_MISSING', 'Message was not encrypted for this device')
      encryptedCiphertext = envelope.ciphertext
    }
  } catch (e) {
    if (e instanceof AstrClientError) throw e
  }
  const payload = base64ToBytes(encryptedCiphertext)
  const nonce = payload.slice(0, 12)
  const ciphertext = payload.slice(12)
  const messageKey = envelopeMode
    ? await v3MessageKey(conversation, user, message.astr.direction, message.astr.counter, senderPublicKey)
    : await v3MessageKey(conversation, user, message.astr.direction, message.astr.counter, message.is_mine ? null : senderPublicKey)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: associatedDataV4(packet) },
    await aesKeyFromBytes(messageKey),
    ciphertext
  )
  return { ...message, body: decoder.decode(plaintext), encrypted: true }
}

async function decryptV2(conversation, message) {
  const payload = base64ToBytes(message.astr.ciphertext)
  const nonce = payload.slice(0, 12)
  const ciphertext = payload.slice(12)
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: associatedDataV2(message.astr.direction, message.astr.counter, message.astr.prev_transcript_hash),
    },
    await v2AesKey(conversation),
    ciphertext
  )
  return { ...message, body: decoder.decode(plaintext), encrypted: true }
}

export async function decryptAstrMessage(conversation, user, message) {
  if (message.body || !message.astr?.ciphertext) return message
  try {
    if (message.astr.version === ASTR_V3) return await decryptV3(conversation, user, message)
    if (message.astr.version === ASTR_V4) return await decryptV4(conversation, user, message)
    if (message.astr.version === ASTR_V2) return await decryptV2(conversation, message)
    return message
  } catch (e) {
    return { ...message, body: 'Message could not be opened', encrypted: true, decrypt_failed: true }
  }
}

export async function decryptConversation(conversation, user) {
  if (!conversation?.messages) return conversation
  await ensureKeyBundleRegistered(user)
  const messages = []
  for (const message of conversation.messages) {
    messages.push(await decryptAstrMessage(conversation, user, message))
  }
  return { ...conversation, messages }
}
