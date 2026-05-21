import { describe, expect, it, beforeAll } from 'vitest'

import {
  ASTR_V4,
  ASTR_VERIFY_CODES,
  ZERO_TRANSCRIPT_HASH,
  canUseStructuralSendState,
  transcriptHash,
  verifyAstrTranscript,
} from './astrTranscript'
import { __test__ as astrClientTest } from './astrClient'

beforeAll(() => {
  if (!globalThis.crypto && globalThis.window?.crypto) globalThis.crypto = globalThis.window.crypto
})

function conversationWith(messages, keyBundles = {}) {
  return {
    id: 1,
    messages,
    key_bundles: keyBundles,
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

const decryptOk = async (_conversation, _user, message) => ({
  ...message,
  body: `plain-${message.astr.counter}`,
  encrypted: true,
})

const decryptByCiphertext = async (_conversation, _user, message) => {
  if (message.astr.ciphertext.includes('missing-envelope')) {
    return {
      ...message,
      body: 'Message could not be verified',
      encrypted: true,
      decrypt_failed: true,
      verify_failed: true,
      verify_error: ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING,
    }
  }
  if (message.astr.ciphertext.includes('tampered')) {
    return {
      ...message,
      body: 'Message could not be verified',
      encrypted: true,
      decrypt_failed: true,
      verify_failed: true,
      verify_error: ASTR_VERIFY_CODES.DECRYPT_FAILED,
    }
  }
  return decryptOk(_conversation, _user, message)
}

describe('ASTR transcript verification', () => {
  it('verifies a valid transcript and advances verified state', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH)
    const second = await packet(1, first.astr.transcript_hash)

    const result = await verifyAstrTranscript(conversationWith([first, second]), { id: 1 }, decryptOk)

    expect(result.transcript_verified).toBe(true)
    expect(result.verified_transcript_hash).toBe(second.astr.transcript_hash)
    expect(result.verified_counters.one_to_two).toBe(2)
    expect(result.messages[1].body).toBe('plain-1')
  })

  it('fails on wrong previous transcript hash', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH)
    const broken = await packet(1, 'bad-prev')

    const result = await verifyAstrTranscript(conversationWith([first, broken]), { id: 1 }, decryptOk)

    expect(result.transcript_verified).toBe(false)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.WRONG_PREVIOUS_TRANSCRIPT)
    expect(result.verified_transcript_hash).toBe(first.astr.transcript_hash)
  })

  it('fails on wrong counter', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH)
    const broken = await packet(2, first.astr.transcript_hash)

    const result = await verifyAstrTranscript(conversationWith([first, broken]), { id: 1 }, decryptOk)

    expect(result.transcript_verified).toBe(false)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.WRONG_COUNTER)
    expect(result.verified_counters.one_to_two).toBe(1)
  })

  it('fails generic decrypt on tampered ciphertext without advancing structural state', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH)
    const tampered = await packet(1, first.astr.transcript_hash, 'one_to_two', { ciphertext: 'tampered-ciphertext' })

    const result = await verifyAstrTranscript(conversationWith([first, tampered]), { id: 1 }, decryptByCiphertext)

    expect(result.transcript_verified).toBe(false)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.DECRYPT_FAILED)
    expect(result.messages[1].decrypt_failed).toBe(true)
    expect(result.verified_transcript_hash).toBe(first.astr.transcript_hash)
    expect(result.structural_transcript_hash).toBe(first.astr.transcript_hash)
    expect(result.structural_counters.one_to_two).toBe(1)
  })

  it('fails on tampered auth tag as transcript-invalid', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH)
    const second = await packet(1, first.astr.transcript_hash)
    const broken = {
      ...second,
      astr: {
        ...second.astr,
        auth_tag: 'tampered-auth-tag',
      },
    }

    const result = await verifyAstrTranscript(conversationWith([first, broken]), { id: 1 }, decryptOk)

    expect(result.transcript_verified).toBe(false)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.TRANSCRIPT_INVALID)
    expect(result.verified_transcript_hash).toBe(first.astr.transcript_hash)
  })

  it('fails replayed packets distinctly', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH)
    const replay = { ...first, id: 99 }

    const result = await verifyAstrTranscript(conversationWith([first, replay]), { id: 1 }, decryptOk)

    expect(result.transcript_verified).toBe(false)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.REPLAY)
    expect(result.verified_counters.one_to_two).toBe(1)
  })

  it('fails sender identity mismatch without advancing structural state', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH)
    const mismatchDecrypt = async (_conversation, _user, message) => ({
      ...message,
      body: 'Message could not be verified',
      encrypted: true,
      decrypt_failed: true,
      verify_failed: true,
      verify_error: ASTR_VERIFY_CODES.IDENTITY_KEY_MISMATCH,
    })

    const result = await verifyAstrTranscript(conversationWith([first]), { id: 2 }, mismatchDecrypt)

    expect(result.transcript_verified).toBe(false)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.IDENTITY_KEY_MISMATCH)
    expect(result.structural_transcript_hash).toBe(ZERO_TRANSCRIPT_HASH)
  })

  it('detects sender identity mismatch against a registered bundle', () => {
    const keyA = { kty: 'EC', crv: 'P-256', x: 'x-a', y: 'y-a' }
    const keyB = { kty: 'EC', crv: 'P-256', x: 'x-b', y: 'y-b' }
    const message = { is_mine: false, astr: { direction: 'one_to_two' } }
    const conversation = conversationWith([], {
      1: { identity_public_key: keyA, signed_prekey_public_key: keyA },
    })

    expect(astrClientTest.senderIdentityMatchesBundle(conversation, message, keyA)).toBe(true)
    expect(astrClientTest.senderIdentityMatchesBundle(conversation, message, keyB)).toBe(false)
  })

  it('keeps device-envelope-missing distinct and structurally safe', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH, 'one_to_two', { ciphertext: 'missing-envelope-ciphertext' })

    const result = await verifyAstrTranscript(conversationWith([first]), { id: 1 }, decryptByCiphertext)

    expect(result.transcript_verified).toBe(false)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING)
    expect(result.verified_transcript_hash).toBe(ZERO_TRANSCRIPT_HASH)
    expect(result.structural_transcript_hash).toBe(first.astr.transcript_hash)
    expect(result.structural_counters.one_to_two).toBe(1)
    expect(canUseStructuralSendState(result)).toBe(true)
  })

  it('does not allow future send from generic decrypt failure', async () => {
    const failing = await packet(0, ZERO_TRANSCRIPT_HASH, 'one_to_two', { ciphertext: 'tampered-ciphertext' })

    const result = await verifyAstrTranscript(conversationWith([failing]), { id: 1 }, decryptByCiphertext)

    expect(result.transcript_verified).toBe(false)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.DECRYPT_FAILED)
    expect(result.verified_transcript_hash).toBe(ZERO_TRANSCRIPT_HASH)
    expect(result.structural_transcript_hash).toBe(ZERO_TRANSCRIPT_HASH)
    expect(canUseStructuralSendState(result)).toBe(false)
  })

  it('advances verified transcript only after successful decrypt', async () => {
    const first = await packet(0, ZERO_TRANSCRIPT_HASH, 'one_to_two', { ciphertext: 'tampered-ciphertext' })
    const result = await verifyAstrTranscript(conversationWith([first]), { id: 1 }, decryptByCiphertext)

    expect(result.transcript_verified).toBe(false)
    expect(result.verified_transcript_hash).toBe(ZERO_TRANSCRIPT_HASH)
    expect(result.verified_counters.one_to_two).toBe(0)
  })
})
