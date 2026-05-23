const encoder = new TextEncoder()

export const ASTR_V2 = 'astr-v2-client-aead'
export const ASTR_V3 = 'astr-v3-ratchet-aead'
export const ASTR_V4 = 'astr-v4-client-state-aead'
export const ZERO_TRANSCRIPT_HASH = 'a9b67b214594b7027c98a410424f12a978d2c8bac051886411180aae6ec1deea'
export const ASTR_MESSAGE_VERSIONS = [ASTR_V2, ASTR_V3, ASTR_V4]
export const ASTR_VERIFY_CODES = {
  DEVICE_ENVELOPE_MISSING: 'device-envelope-missing',
  DECRYPT_FAILED: 'decrypt-failed',
  TRANSCRIPT_INVALID: 'transcript-invalid',
  IDENTITY_KEY_MISMATCH: 'identity-key-mismatch',
  IDENTITY_KEY_CHANGED: 'identity-key-changed',
  SECURE_STATE_MISMATCH: 'secure-state-mismatch',
  UNSUPPORTED_VERSION: 'unsupported-version',
  REPLAY: 'replay',
  WRONG_COUNTER: 'wrong-counter',
  WRONG_PREVIOUS_TRANSCRIPT: 'wrong-previous-transcript',
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function transcriptHash(prevTranscriptHash, direction, counter, stateCommitment, ciphertext, authTag) {
  return sha256Hex(`${prevTranscriptHash}|${direction}|${counter}|${stateCommitment || ''}|${ciphertext}|${authTag}`)
}

export function stateCommitmentForAstr(astr) {
  if (astr?.version === ASTR_V2) return ''
  if (astr?.version === ASTR_V4) return astr.sender_state_commitment || astr.ratchet_public_key || ''
  if (astr?.version === ASTR_V3) return astr.ratchet_public_key || ''
  return ''
}

function failedVerifiedMessage(message, transcriptHashValue, code, decryptFailed = false) {
  return {
    ...message,
    body: 'Message could not be verified',
    encrypted: Boolean(message.astr),
    decrypt_failed: decryptFailed,
    verify_failed: true,
    verify_error: code,
    verified_transcript_hash: transcriptHashValue,
  }
}

export function canUseStructuralSendState(conversation) {
  return Boolean(
    conversation?.transcript_verified === false
    && conversation?.transcript_error === ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING
    && typeof conversation?.structural_transcript_hash === 'string'
    && conversation.structural_transcript_hash.length > 0
    && conversation?.structural_counters
  )
}

export async function verifyAstrTranscript(conversation, user, decryptMessage) {
  const verifiedCounters = { one_to_two: 0, two_to_one: 0 }
  const structuralCounters = { one_to_two: 0, two_to_one: 0 }
  const seenPackets = new Set()
  let verifiedTranscriptHash = ZERO_TRANSCRIPT_HASH
  let structuralTranscriptHash = ZERO_TRANSCRIPT_HASH
  let transcriptVerified = true
  let transcriptError = null
  const messages = []

  for (const message of conversation.messages || []) {
    const astr = message.astr
    if (!astr?.version) {
      messages.push(message)
      continue
    }

    const fail = (code, decryptFailed = false) => {
      if (!transcriptError) transcriptError = code
      transcriptVerified = false
      messages.push(failedVerifiedMessage(message, verifiedTranscriptHash, code, decryptFailed))
    }

    if (!ASTR_MESSAGE_VERSIONS.includes(astr.version)) {
      fail(ASTR_VERIFY_CODES.UNSUPPORTED_VERSION)
      continue
    }
    if (!['one_to_two', 'two_to_one'].includes(astr.direction)) {
      fail(ASTR_VERIFY_CODES.TRANSCRIPT_INVALID)
      continue
    }

    const counter = Number(astr.counter)
    if (!Number.isInteger(counter)) {
      fail(ASTR_VERIFY_CODES.WRONG_COUNTER)
      continue
    }
    if (!astr.ciphertext || !astr.auth_tag || !astr.transcript_hash) {
      fail(ASTR_VERIFY_CODES.TRANSCRIPT_INVALID)
      continue
    }

    const stateCommitment = stateCommitmentForAstr(astr)
    if ([ASTR_V3, ASTR_V4].includes(astr.version) && !stateCommitment) {
      fail(ASTR_VERIFY_CODES.TRANSCRIPT_INVALID)
      continue
    }

    const packetKey = `${astr.version}:${astr.direction}:${counter}:${astr.prev_transcript_hash}:${astr.transcript_hash}:${stateCommitment}:${astr.ciphertext}:${astr.auth_tag}`
    if (seenPackets.has(packetKey)) {
      fail(ASTR_VERIFY_CODES.REPLAY)
      continue
    }
    if (counter !== structuralCounters[astr.direction]) {
      fail(ASTR_VERIFY_CODES.WRONG_COUNTER)
      continue
    }
    if (astr.prev_transcript_hash !== structuralTranscriptHash) {
      fail(ASTR_VERIFY_CODES.WRONG_PREVIOUS_TRANSCRIPT)
      continue
    }

    const expectedHash = await transcriptHash(
      structuralTranscriptHash,
      astr.direction,
      counter,
      stateCommitment,
      astr.ciphertext,
      astr.auth_tag
    )
    if (expectedHash !== astr.transcript_hash) {
      fail(ASTR_VERIFY_CODES.TRANSCRIPT_INVALID)
      continue
    }

    let decrypted
    try {
      decrypted = await decryptMessage(conversation, user, message)
    } catch (e) {
      const code = e?.verify_error || e?.code || ASTR_VERIFY_CODES.DECRYPT_FAILED
      if (code === ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING) {
        structuralTranscriptHash = expectedHash
        structuralCounters[astr.direction] = counter + 1
        seenPackets.add(packetKey)
      }
      fail(code, true)
      continue
    }
    if (decrypted.decrypt_failed || decrypted.verify_failed) {
      const code = decrypted.verify_error || decrypted.decrypt_error || ASTR_VERIFY_CODES.DECRYPT_FAILED
      if (code === ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING) {
        structuralTranscriptHash = expectedHash
        structuralCounters[astr.direction] = counter + 1
        seenPackets.add(packetKey)
      }
      fail(code, true)
      continue
    }

    structuralTranscriptHash = expectedHash
    structuralCounters[astr.direction] = counter + 1
    verifiedTranscriptHash = expectedHash
    verifiedCounters[astr.direction] = counter + 1
    seenPackets.add(packetKey)
    messages.push({
      ...decrypted,
      verify_failed: false,
      verified_transcript_hash: verifiedTranscriptHash,
    })
  }

  return {
    messages,
    verified_transcript_hash: verifiedTranscriptHash,
    verified_counters: verifiedCounters,
    structural_transcript_hash: structuralTranscriptHash,
    structural_counters: structuralCounters,
    transcript_verified: transcriptVerified,
    transcript_error: transcriptError,
  }
}
