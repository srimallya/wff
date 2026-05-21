import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) globalThis.crypto = webcrypto

const { ASTR_V4, ZERO_TRANSCRIPT_HASH, transcriptHash, verifyAstrTranscript } = await import('./astrTranscript.js')

function conversationWith(messages) {
  return {
    id: 1,
    messages,
    participants: {
      one: { id: 1 },
      two: { id: 2 },
    },
  }
}

async function packet(counter, prevHash, direction = 'one_to_two', overrides = {}) {
  const ciphertext = overrides.ciphertext || `ciphertext-${counter}`
  const authTag = overrides.auth_tag || `auth-${counter}`
  const senderStateCommitment = overrides.sender_state_commitment || `commitment-${counter}`
  const nextHash = overrides.transcript_hash || await transcriptHash(
    prevHash,
    direction,
    counter,
    senderStateCommitment,
    ciphertext,
    authTag
  )
  return {
    id: counter + 1,
    body: '',
    is_mine: direction === 'one_to_two',
    sender_username: direction === 'one_to_two' ? 'alice' : 'bob',
    astr: {
      version: ASTR_V4,
      direction,
      counter,
      previous_chain_length: 0,
      sender_state_commitment: senderStateCommitment,
      prev_transcript_hash: prevHash,
      transcript_hash: nextHash,
      ciphertext,
      auth_tag: authTag,
    },
  }
}

const decryptOk = async (_conversation, _user, message) => ({ ...message, body: `plain-${message.astr.counter}`, encrypted: true })
const decryptFailsOnTamper = async (_conversation, _user, message) => {
  if (message.astr.ciphertext.includes('tampered')) {
    return { ...message, body: 'Message could not be verified', decrypt_failed: true }
  }
  return { ...message, body: `plain-${message.astr.counter}`, encrypted: true }
}

async function run() {
  const first = await packet(0, ZERO_TRANSCRIPT_HASH)
  const second = await packet(1, first.astr.transcript_hash)

  {
    const result = await verifyAstrTranscript(conversationWith([first, second]), { id: 1 }, decryptOk)
    assert.equal(result.transcript_verified, true)
    assert.equal(result.verified_transcript_hash, second.astr.transcript_hash)
    assert.equal(result.verified_counters.one_to_two, 2)
    assert.equal(result.messages[1].body, 'plain-1')
  }

  {
    const broken = await packet(1, 'bad-prev')
    const result = await verifyAstrTranscript(conversationWith([first, broken]), { id: 1 }, decryptOk)
    assert.equal(result.transcript_verified, false)
    assert.equal(result.transcript_error, 'wrong-previous-transcript')
    assert.equal(result.verified_transcript_hash, first.astr.transcript_hash)
  }

  {
    const broken = await packet(2, first.astr.transcript_hash)
    const result = await verifyAstrTranscript(conversationWith([first, broken]), { id: 1 }, decryptOk)
    assert.equal(result.transcript_verified, false)
    assert.equal(result.transcript_error, 'wrong-counter')
    assert.equal(result.verified_counters.one_to_two, 1)
  }

  {
    const tampered = await packet(1, first.astr.transcript_hash, 'one_to_two', { ciphertext: 'tampered-ciphertext' })
    const result = await verifyAstrTranscript(conversationWith([first, tampered]), { id: 1 }, decryptFailsOnTamper)
    assert.equal(result.transcript_verified, false)
    assert.equal(result.transcript_error, 'decrypt-failed')
    assert.equal(result.messages[1].decrypt_failed, true)
    assert.equal(result.verified_transcript_hash, first.astr.transcript_hash)
    assert.equal(result.structural_transcript_hash, tampered.astr.transcript_hash)
    assert.equal(result.structural_counters.one_to_two, 2)
  }

  {
    const broken = {
      ...second,
      astr: {
        ...second.astr,
        auth_tag: 'tampered-auth-tag',
      },
    }
    const result = await verifyAstrTranscript(conversationWith([first, broken]), { id: 1 }, decryptOk)
    assert.equal(result.transcript_verified, false)
    assert.equal(result.transcript_error, 'transcript-hash-mismatch')
    assert.equal(result.verified_transcript_hash, first.astr.transcript_hash)
  }

  {
    const replay = { ...first, id: 99 }
    const result = await verifyAstrTranscript(conversationWith([first, replay]), { id: 1 }, decryptOk)
    assert.equal(result.transcript_verified, false)
    assert.equal(result.transcript_error, 'wrong-counter')
    assert.equal(result.verified_counters.one_to_two, 1)
  }

  {
    const failing = await packet(0, ZERO_TRANSCRIPT_HASH, 'one_to_two', { ciphertext: 'tampered-ciphertext' })
    const replacement = await packet(0, ZERO_TRANSCRIPT_HASH, 'one_to_two', { ciphertext: 'ciphertext-replacement' })
    const result = await verifyAstrTranscript(conversationWith([failing, replacement]), { id: 1 }, decryptFailsOnTamper)
    assert.equal(result.transcript_verified, false)
    assert.equal(result.transcript_error, 'decrypt-failed')
    assert.equal(result.messages[1].verify_error, 'wrong-counter')
    assert.equal(result.verified_transcript_hash, ZERO_TRANSCRIPT_HASH)
    assert.equal(result.verified_counters.one_to_two, 0)
    assert.equal(result.structural_transcript_hash, failing.astr.transcript_hash)
    assert.equal(result.structural_counters.one_to_two, 1)
  }
}

await run()
console.log('astrClient transcript tests passed')
