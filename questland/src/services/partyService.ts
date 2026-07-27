// Parties. When the cloud is reachable the invite code is claimed and validated
// in Firestore, so a code created on one phone is answerable from any other and
// two parties can never share one. When it is not, everything falls back to the
// original local-only behaviour and the party simply stays on this device.
//
// Reads stay synchronous — they hit the local mirror that cloudSync keeps fresh.
// Only the writes, which need a server verdict, are async.

import type { Party } from '../types'
import { load, save } from './store'
import { uid, shortCode } from './ids'
import { getUser, updateProfile } from './authService'
import * as cloudSync from './cloudSync'
import { isConfigured } from './firebase'

const PARTIES_KEY = 'ql:parties'
const CODE_ATTEMPTS = 5

export type PartyOutcome = { ok: true; party: Party } | { ok: false; error: string }

function getParties(): Party[] {
  return load<Party[]>(PARTIES_KEY, [])
}

function setParties(parties: Party[]): void {
  save(PARTIES_KEY, parties)
}

function upsertParty(party: Party): Party {
  const parties = getParties()
  const idx = parties.findIndex((p) => p.id === party.id)
  if (idx === -1) {
    setParties([...parties, party])
  } else {
    const next = [...parties]
    next[idx] = party
    setParties(next)
  }
  return party
}

export function listParties(): Party[] {
  return getParties()
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '')
}

export function getParty(id: string): Party | null {
  return getParties().find((p) => p.id === id) ?? null
}

export function getPartyByCode(code: string): Party | null {
  const normalized = normalizeCode(code)
  return getParties().find((p) => normalizeCode(p.code) === normalized) ?? null
}

export function getUserParty(userId: string): Party | null {
  const user = getUser(userId)
  const parties = getParties()
  if (user?.partyId) {
    const byId = parties.find((p) => p.id === user.partyId)
    if (byId) return byId
  }
  return parties.find((p) => p.memberIds.includes(userId)) ?? null
}

function generateCode(): string {
  const existing = new Set(getParties().map((p) => normalizeCode(p.code)))
  let code = shortCode(6)
  while (existing.has(code)) {
    code = shortCode(6)
  }
  return code
}

function partyNameFor(userId: string, name: string): string {
  const trimmed = name.trim()
  if (trimmed) return trimmed
  const user = getUser(userId)
  return `${(user?.name ?? 'Adventurer').split(' ')[0]}'s Party`
}

/** Drops the guest from whatever party they were in, locally and in the cloud. */
async function detachFrom(party: Party, userId: string): Promise<void> {
  if (party.cloud) await cloudSync.leavePartyDoc(party.id, userId)

  const memberIds = party.memberIds.filter((id) => id !== userId)
  if (memberIds.length === 0) {
    setParties(getParties().filter((p) => p.id !== party.id))
    return
  }
  setParties(getParties().map((p) => (p.id === party.id ? { ...p, memberIds } : p)))
}

export async function createParty(userId: string, name: string): Promise<PartyOutcome> {
  const partyName = partyNameFor(userId, name)
  const previous = getUserParty(userId)

  if (isConfigured()) {
    // Retry only while the server keeps telling us the code is spoken for.
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const candidate: Party = {
        id: uid(),
        code: generateCode(),
        name: partyName,
        memberIds: [userId],
        cloud: true,
        createdAt: Date.now(),
      }
      const result = await cloudSync.createPartyDoc(candidate)
      if (result.ok) {
        if (previous) await detachFrom(previous, userId)
        upsertParty(result.value)
        updateProfile(userId, { partyId: result.value.id })
        return { ok: true, party: result.value }
      }
      if (result.reason === 'unavailable') break
    }
  }

  const party: Party = {
    id: uid(),
    code: generateCode(),
    name: partyName,
    memberIds: [userId],
    createdAt: Date.now(),
  }
  if (previous) await detachFrom(previous, userId)
  upsertParty(party)
  updateProfile(userId, { partyId: party.id })
  return { ok: true, party }
}

// NOTE: joining no longer notifies the other members from here. Writing into
// someone else's inbox is a staff power now, so each member's own device raises
// the announcement when it sees the roster change (cloudSync.announceNewMembers).

export async function joinParty(userId: string, code: string): Promise<PartyOutcome> {
  const previous = getUserParty(userId)

  if (isConfigured()) {
    const result = await cloudSync.joinPartyDoc(code, userId)
    if (result.ok) {
      const party = result.value
      if (previous && previous.id !== party.id) await detachFrom(previous, userId)
      upsertParty(party)
      updateProfile(userId, { partyId: party.id })
      return { ok: true, party }
    }
    if (result.reason === 'not-found') {
      return { ok: false, error: 'No party answers to that code.' }
    }
    // 'unavailable' — try the local mirror before giving up.
  }

  const party = getPartyByCode(code)
  if (!party) {
    return { ok: false, error: 'No party answers to that code.' }
  }

  const memberIds = party.memberIds.includes(userId) ? party.memberIds : [...party.memberIds, userId]
  const updated: Party = { ...party, memberIds }
  if (previous && previous.id !== party.id) await detachFrom(previous, userId)
  upsertParty(updated)
  updateProfile(userId, { partyId: party.id })
  return { ok: true, party: updated }
}

export async function leaveParty(userId: string): Promise<void> {
  const party = getUserParty(userId)
  // updateProfile's patch type doesn't allow `undefined` for partyId — clear
  // it with '' and treat '' the same as "no party" in getUserParty above.
  updateProfile(userId, { partyId: '' })
  if (!party) return
  await detachFrom(party, userId)
}

export function renameParty(partyId: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const party = getParty(partyId)
  setParties(getParties().map((p) => (p.id === partyId ? { ...p, name: trimmed } : p)))
  if (party?.cloud) cloudSync.renamePartyDoc(partyId, trimmed)
}
