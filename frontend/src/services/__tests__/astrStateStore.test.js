import { beforeEach, describe, expect, it } from 'vitest'

import { ASTR_VERIFY_CODES, ZERO_TRANSCRIPT_HASH, transcriptHash, verifyAstrTranscript } from '../astrTranscript'
import {
  __resetAstrStateStoreForTests,
  computeSafetyNumber,
  detectIdentityChange,
  getIdentityPin,
  getAstrConversationState,
  markIdentityChangeAccepted,
  markIdentityVerified,
  reconcileAstrConversationState,
} from '../astrStateStore'
import { createAstrPacket } from '../astrClient'

const localStorageMock = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  }
}

function verifiedMessage(id, transcriptHash, extra = {}) {
  return {
    id,
    body: `plain-${id}`,
    verified_transcript_hash: transcriptHash,
    astr: {
      version: 'astr-v4-client-state-aead',
      transcript_hash: transcriptHash,
    },
    ...extra,
  }
}

function verification(messages, overrides = {}) {
  const last = [...messages].reverse().find((message) => !message.verify_failed)
  return {
    messages,
    verified_transcript_hash: last?.verified_transcript_hash || ZERO_TRANSCRIPT_HASH,
    verified_counters: { one_to_two: messages.filter((message) => !message.verify_failed).length, two_to_one: 0 },
    structural_transcript_hash: last?.astr?.transcript_hash || ZERO_TRANSCRIPT_HASH,
    structural_counters: { one_to_two: messages.length, two_to_one: 0 },
    transcript_verified: true,
    transcript_error: null,
    ...overrides,
  }
}

const user = { id: 1, username: 'alice' }
const conversation = { id: 99 }
const keyA = { kty: 'EC', crv: 'P-256', x: 'x-a', y: 'y-a' }
const keyB = { kty: 'EC', crv: 'P-256', x: 'x-b', y: 'y-b' }
const keyC = { kty: 'EC', crv: 'P-256', x: 'x-c', y: 'y-c' }

beforeEach(() => {
  globalThis.localStorage = localStorageMock()
  globalThis.indexedDB = undefined
  __resetAstrStateStoreForTests()
})

describe('ASTR identity pins', () => {
  it('pins first-seen identity as unverified TOFU', async () => {
    const result = await detectIdentityChange({
      localUserId: 1,
      remoteUserId: 2,
      identityPublicKey: keyA,
      signedPrekeyPublicKey: keyA,
    })

    expect(result.first_seen).toBe(true)
    expect(result.changed).toBe(false)
    expect(result.pin.verified).toBe(false)
    expect(result.pin.changed).toBe(false)
    expect(result.pin.identity_public_key_fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('passes when the same identity appears again', async () => {
    await detectIdentityChange({ localUserId: 1, remoteUserId: 2, identityPublicKey: keyA, signedPrekeyPublicKey: keyA })

    const result = await detectIdentityChange({ localUserId: 1, remoteUserId: 2, identityPublicKey: keyA, signedPrekeyPublicKey: keyA })

    expect(result.changed).toBe(false)
    expect(result.pin.changed).toBe(false)
  })

  it('flags changed identity and records previous fingerprint', async () => {
    const first = await detectIdentityChange({ localUserId: 1, remoteUserId: 2, identityPublicKey: keyA, signedPrekeyPublicKey: keyA })

    const changed = await detectIdentityChange({ localUserId: 1, remoteUserId: 2, identityPublicKey: keyB, signedPrekeyPublicKey: keyB })

    expect(changed.changed).toBe(true)
    expect(changed.pin.changed).toBe(true)
    expect(changed.pin.previous_fingerprint).toBe(first.pin.identity_public_key_fingerprint)
    expect(changed.pin.current_fingerprint).not.toBe(first.pin.identity_public_key_fingerprint)
  })

  it('blocks send when conversation identity changed', async () => {
    await expect(createAstrPacket({
      id: 7,
      identity_changed: true,
      participants: { one: { id: 1 }, two: { id: 2 } },
    }, user, 'hello')).rejects.toMatchObject({
      code: 'IDENTITY_KEY_CHANGED',
      message: 'Secure identity changed. Review security details before sending.',
    })
  })

  it('accept changed identity updates the pin and clears changed state', async () => {
    await detectIdentityChange({ localUserId: 1, remoteUserId: 2, identityPublicKey: keyA, signedPrekeyPublicKey: keyA })
    const changed = await detectIdentityChange({ localUserId: 1, remoteUserId: 2, identityPublicKey: keyB, signedPrekeyPublicKey: keyB })

    const accepted = await markIdentityChangeAccepted(1, 2)

    expect(accepted.changed).toBe(false)
    expect(accepted.verified).toBe(false)
    expect(accepted.identity_public_key_fingerprint).toBe(changed.pin.current_fingerprint)
  })

  it('mark verified persists verified status', async () => {
    await detectIdentityChange({ localUserId: 1, remoteUserId: 2, identityPublicKey: keyA, signedPrekeyPublicKey: keyA })

    const verified = await markIdentityVerified(1, 2)
    const stored = await getIdentityPin(1, 2)

    expect(verified.verified).toBe(true)
    expect(stored.verified).toBe(true)
  })

  it('safety number is deterministic', async () => {
    const first = await computeSafetyNumber(keyA, keyB)
    const reversed = await computeSafetyNumber(keyB, keyA)

    expect(first).toBe(reversed)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('safety number changes if either identity changes', async () => {
    const first = await computeSafetyNumber(keyA, keyB)
    const changed = await computeSafetyNumber(keyA, keyC)

    expect(changed).not.toBe(first)
  })
})

describe('ASTR local state store', () => {
  it('bootstraps local state on first verified load', async () => {
    const first = verifiedMessage(10, 'hash-1')

    const result = await reconcileAstrConversationState(conversation, user, verification([first]))

    expect(result.secure_state_mismatch).toBe(false)
    expect(result.state.verified_transcript_hash).toBe('hash-1')
    expect(result.state.last_verified_message_id).toBe(10)
    await expect(getAstrConversationState(conversation, user)).resolves.toMatchObject({
      verified_transcript_hash: 'hash-1',
    })
  })

  it('reload preserves and advances consistent local state', async () => {
    const first = verifiedMessage(10, 'hash-1')
    await reconcileAstrConversationState(conversation, user, verification([first]))
    const second = verifiedMessage(11, 'hash-2')

    const result = await reconcileAstrConversationState(conversation, user, verification([first, second]))

    expect(result.secure_state_mismatch).toBe(false)
    expect(result.state.verified_transcript_hash).toBe('hash-2')
    expect(result.state.last_verified_message_id).toBe(11)
  })

  it('detects server omission of the last locally verified message', async () => {
    const first = verifiedMessage(10, 'hash-1')
    const second = verifiedMessage(11, 'hash-2')
    await reconcileAstrConversationState(conversation, user, verification([first, second]))

    const result = await reconcileAstrConversationState(conversation, user, verification([first]))

    expect(result.secure_state_mismatch).toBe(true)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.SECURE_STATE_MISMATCH)
  })

  it('detects server rewrite of the locally verified transcript point', async () => {
    const first = verifiedMessage(10, 'hash-1')
    await reconcileAstrConversationState(conversation, user, verification([first]))
    const rewritten = verifiedMessage(10, 'rewritten-hash')

    const result = await reconcileAstrConversationState(conversation, user, verification([rewritten]))

    expect(result.secure_state_mismatch).toBe(true)
    expect(result.transcript_error).toBe(ASTR_VERIFY_CODES.SECURE_STATE_MISMATCH)
  })

  it('does not persist generic decrypt failure as verified state', async () => {
    const failed = verifiedMessage(10, ZERO_TRANSCRIPT_HASH, {
      verify_failed: true,
      decrypt_failed: true,
      verify_error: ASTR_VERIFY_CODES.DECRYPT_FAILED,
    })

    await reconcileAstrConversationState(conversation, user, verification([failed], {
      transcript_verified: false,
      transcript_error: ASTR_VERIFY_CODES.DECRYPT_FAILED,
      verified_transcript_hash: ZERO_TRANSCRIPT_HASH,
      verified_counters: { one_to_two: 0, two_to_one: 0 },
      structural_transcript_hash: ZERO_TRANSCRIPT_HASH,
      structural_counters: { one_to_two: 0, two_to_one: 0 },
    }))

    await expect(getAstrConversationState(conversation, user)).resolves.toBeNull()
  })

  it('persists structural state only for device-envelope-missing', async () => {
    const missingEnvelope = verifiedMessage(10, 'hash-structural', {
      verify_failed: true,
      decrypt_failed: true,
      verify_error: ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING,
    })

    const result = await reconcileAstrConversationState(conversation, user, verification([missingEnvelope], {
      transcript_verified: false,
      transcript_error: ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING,
      verified_transcript_hash: ZERO_TRANSCRIPT_HASH,
      verified_counters: { one_to_two: 0, two_to_one: 0 },
      structural_transcript_hash: 'hash-structural',
      structural_counters: { one_to_two: 1, two_to_one: 0 },
    }))

    expect(result.state.verified_transcript_hash).toBe(ZERO_TRANSCRIPT_HASH)
    expect(result.state.structural_transcript_hash).toBe('hash-structural')
    await expect(getAstrConversationState(conversation, user)).resolves.toMatchObject({
      transcript_verified: false,
      transcript_error: ASTR_VERIFY_CODES.DEVICE_ENVELOPE_MISSING,
    })
  })

  it('allows server-purged history to reset local transcript state', async () => {
    const first = verifiedMessage(10, 'hash-1')
    await reconcileAstrConversationState(conversation, user, verification([first]))

    const result = await reconcileAstrConversationState(
      { ...conversation, messages_purged_at: '2026-05-24T00:00:00.000Z' },
      user,
      verification([])
    )

    expect(result.secure_state_mismatch).toBe(false)
    expect(result.state.verified_transcript_hash).toBe(ZERO_TRANSCRIPT_HASH)
    expect(result.state.last_verified_message_id).toBeNull()
    await expect(getAstrConversationState(conversation, user)).resolves.toMatchObject({
      verified_transcript_hash: ZERO_TRANSCRIPT_HASH,
      last_verified_message_id: null,
    })
  })
})

describe('ASTR locally cleared transcript verification', () => {
  it('can verify new visible messages from the persisted cleared baseline', async () => {
    const nextHash = await transcriptHash('hash-before-clear', 'one_to_two', 2, 'state', 'cipher', 'a'.repeat(64))
    const visibleMessage = {
      id: 12,
      body: '',
      astr: {
        version: 'astr-v4-client-state-aead',
        direction: 'one_to_two',
        counter: 2,
        prev_transcript_hash: 'hash-before-clear',
        transcript_hash: nextHash,
        ratchet_public_key: 'state',
        ciphertext: 'cipher',
        auth_tag: 'a'.repeat(64),
      },
    }

    const result = await verifyAstrTranscript({
      id: 99,
      initial_transcript_state: {
        verified_transcript_hash: 'hash-before-clear',
        structural_transcript_hash: 'hash-before-clear',
        verified_counters: { one_to_two: 2, two_to_one: 0 },
        structural_counters: { one_to_two: 2, two_to_one: 0 },
      },
      messages: [visibleMessage],
    }, user, async () => ({ ...visibleMessage, body: 'new after clear' }))

    expect(result.transcript_verified).toBe(true)
    expect(result.verified_transcript_hash).toBe(nextHash)
    expect(result.verified_counters.one_to_two).toBe(3)
    expect(result.messages[0].body).toBe('new after clear')
  })
})
