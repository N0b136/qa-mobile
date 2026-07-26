import type { Party } from '../types'
import { load, save } from './store'
import { uid, shortCode } from './ids'
import { getUser, updateProfile } from './authService'
import * as notificationService from './notificationService'

const PARTIES_KEY = 'ql:parties'

function getParties(): Party[] {
  return load<Party[]>(PARTIES_KEY, [])
}

function setParties(parties: Party[]): void {
  save(PARTIES_KEY, parties)
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

export function createParty(userId: string, name: string): Party {
  const user = getUser(userId)
  const trimmed = name.trim()
  const partyName = trimmed || `${(user?.name ?? 'Adventurer').split(' ')[0]}'s Party`

  const party: Party = {
    id: uid(),
    code: generateCode(),
    name: partyName,
    memberIds: [userId],
  }

  setParties([...getParties(), party])
  updateProfile(userId, { partyId: party.id })

  return party
}

export function joinParty(userId: string, code: string): { ok: true; party: Party } | { ok: false; error: string } {
  const party = getPartyByCode(code)
  if (!party) {
    return { ok: false, error: 'No party answers to that code.' }
  }

  const memberIds = party.memberIds.includes(userId) ? party.memberIds : [...party.memberIds, userId]
  const updated: Party = { ...party, memberIds }
  setParties(getParties().map((p) => (p.id === party.id ? updated : p)))
  updateProfile(userId, { partyId: party.id })

  const joiner = getUser(userId)
  const joinerName = joiner?.name ?? 'An adventurer'
  for (const memberId of party.memberIds) {
    if (memberId === userId) continue
    notificationService.add(memberId, {
      type: 'system',
      title: `${joinerName} joined your party`,
      body: `${joinerName} answered your invite code and is now travelling with ${updated.name}.`,
      icon: 'users',
    })
  }

  return { ok: true, party: updated }
}

export function leaveParty(userId: string): void {
  const party = getUserParty(userId)
  // updateProfile's patch type doesn't allow `undefined` for partyId — clear
  // it with '' and treat '' the same as "no party" in getUserParty above.
  updateProfile(userId, { partyId: '' })
  if (!party) return

  const memberIds = party.memberIds.filter((id) => id !== userId)
  if (memberIds.length === 0) {
    setParties(getParties().filter((p) => p.id !== party.id))
    return
  }
  setParties(getParties().map((p) => (p.id === party.id ? { ...p, memberIds } : p)))
}

export function renameParty(partyId: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  setParties(getParties().map((p) => (p.id === partyId ? { ...p, name: trimmed } : p)))
}
