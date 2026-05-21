const encoder = new TextEncoder()

export const ASTR_V2 = 'astr-v2-client-aead'
export const ASTR_V3 = 'astr-v3-ratchet-aead'
export const ASTR_V4 = 'astr-v4-client-state-aead'
export const ZERO_TRANSCRIPT_HASH = 'a9b67b214594b7027c98a410424f12a978d2c8bac051886411180aae6ec1deea'
export const ASTR_MESSAGE_VERSIONS = [ASTR_V2, ASTR_V3, ASTR_V4]

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
      fail('unsupported-version')
      continue
    }
    if (!['one_to_two', 'two_to_one'].includes(astr.direction)) {
      fail('wrong-direction')
      continue
    }

    const counter = Number(astr.counter)
    if (!Number.isInteger(counter) || counter !== structuralCounters[astr.direction]) {
      fail('wrong-counter')
      continue
    }
    if (astr.prev_transcript_hash !== structuralTranscriptHash) {
      fail('wrong-previous-transcript')
      continue
    }
    if (!astr.ciphertext || !astr.auth_tag || !astr.transcript_hash) {
      fail('packet-incomplete')
      continue
    }

    const stateCommitment = stateCommitmentForAstr(astr)
    if ([ASTR_V3, ASTR_V4].includes(astr.version) && !stateCommitment) {
      fail('state-commitment-missing')
      continue
    }

    const packetKey = `${astr.direction}:${counter}:${astr.prev_transcript_hash}:${astr.transcript_hash}`
    if (seenPackets.has(packetKey)) {
      fail('replay')
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
      fail('transcript-hash-mismatch')
      continue
    }

    let decrypted
    try {
      decrypted = await decryptMessage(conversation, user, message)
    } catch (e) {
      structuralTranscriptHash = expectedHash
      structuralCounters[astr.direction] = counter + 1
      seenPackets.add(packetKey)
      fail('decrypt-failed', true)
      continue
    }
    if (decrypted.decrypt_failed || decrypted.verify_failed) {
      structuralTranscriptHash = expectedHash
      structuralCounters[astr.direction] = counter + 1
      seenPackets.add(packetKey)
      fail('decrypt-failed', true)
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
