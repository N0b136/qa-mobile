// Accounts. Cloud-first when Firebase is reachable and the Email/Password
// provider is on: Firebase Auth validates the credential and owns email
// uniqueness, `User.id` IS the Firebase uid, and accounts/{uid} carries the
// private profile so signing in on a second device restores you.
//
// Every cloud path degrades to the original local-only account when the cloud
// says "unavailable" (placeholder config, provider not enabled yet, offline),
// so the app still runs standalone exactly as it did before.

import type { User } from '../types'
import { load, remove, save } from './store'
import { uid } from './ids'
import * as cloudSync from './cloudSync'
import {
  cloudSignIn,
  cloudSignOut,
  cloudSignUp,
  fetchAccount,
  pushAccount,
  type AccountDoc,
} from './cloudAuth'
import { ensureFirebase, hasRealAuth, isConfigured } from './firebase'

const USERS_KEY = 'ql:users'
const SESSION_KEY = 'ql:session'

async function hashPassword(password: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const data = new TextEncoder().encode(password)
      const digest = await crypto.subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    // fall through to btoa fallback below
  }
  try {
    return btoa(unescape(encodeURIComponent(password)))
  } catch {
    return password
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function getUsers(): User[] {
  return load<User[]>(USERS_KEY, [])
}

function setUsers(users: User[]): void {
  save(USERS_KEY, users)
}

/** Writes one user into ql:users, replacing any record with the same id. */
function upsertUser(user: User): User {
  const users = getUsers()
  const idx = users.findIndex((u) => u.id === user.id)
  if (idx === -1) {
    setUsers([...users, user])
  } else {
    const next = [...users]
    next[idx] = user
    setUsers(next)
  }
  return user
}

function findLocalByEmail(email: string): User | null {
  const normalized = normalizeEmail(email)
  return getUsers().find((u) => !u.remote && normalizeEmail(u.email) === normalized) ?? null
}

// ── Legacy → cloud migration ─────────────────────────────────────────────────

// Everything keyed by user id that lives outside ql:users. When a local account
// is promoted to a real Firebase account its id changes (local uuid → auth uid),
// so its data has to move with it.
function progressKey(id: string): string {
  return `ql:progress:${id}`
}

/**
 * Moves a local-only account's data onto its new cloud uid and drops the old
 * record. Progress unions (episodes are only ever added), bookings and
 * notifications concatenate and de-duplicate by id.
 */
function adoptLocalData(oldId: string, newId: string): void {
  if (oldId === newId) return

  const oldProgress = load<Record<string, string[]>>(progressKey(oldId), {})
  const newProgress = load<Record<string, string[]>>(progressKey(newId), {})
  const mergedProgress: Record<string, string[]> = { ...newProgress }
  for (const orgId of Object.keys(oldProgress)) {
    mergedProgress[orgId] = Array.from(new Set([...(newProgress[orgId] ?? []), ...oldProgress[orgId]]))
  }
  if (Object.keys(mergedProgress).length > 0) save(progressKey(newId), mergedProgress)

  for (const prefix of ['ql:bookings', 'ql:notifications']) {
    const oldList = load<Array<{ id: string; userId?: string }>>(`${prefix}:${oldId}`, [])
    if (oldList.length === 0) continue
    const newList = load<Array<{ id: string; userId?: string }>>(`${prefix}:${newId}`, [])
    const seen = new Set(newList.map((item) => item.id))
    const carried = oldList
      .filter((item) => !seen.has(item.id))
      .map((item) => (item.userId !== undefined ? { ...item, userId: newId } : item))
    save(`${prefix}:${newId}`, [...newList, ...carried])
  }

  const oldReminders = load<string[]>(`ql:reminders:${oldId}`, [])
  if (oldReminders.length > 0) {
    const merged = new Set([...load<string[]>(`ql:reminders:${newId}`, []), ...oldReminders])
    save(`ql:reminders:${newId}`, Array.from(merged))
  }

  // Carry party membership across the id change.
  const parties = load<Array<{ id: string; memberIds: string[] }>>('ql:parties', [])
  let partiesChanged = false
  const nextParties = parties.map((p) => {
    if (!p.memberIds.includes(oldId)) return p
    partiesChanged = true
    const memberIds = p.memberIds.filter((id) => id !== oldId)
    if (!memberIds.includes(newId)) memberIds.push(newId)
    return { ...p, memberIds }
  })
  if (partiesChanged) save('ql:parties', nextParties)

  for (const prefix of ['ql:progress', 'ql:bookings', 'ql:notifications', 'ql:reminders']) {
    remove(`${prefix}:${oldId}`)
  }

  setUsers(getUsers().filter((u) => u.id !== oldId))
}

/** Builds the local record for a validated cloud account, folding in any prior local one. */
function localRecordForCloud(
  uidValue: string,
  email: string,
  fallbackName: string,
  fallbackAvatar: string,
  account: AccountDoc | null,
  legacy: User | null
): User {
  const existing = getUsers().find((u) => u.id === uidValue) ?? null
  const user: User = {
    id: uidValue,
    email,
    name: account?.name ?? existing?.name ?? legacy?.name ?? fallbackName,
    avatar: account?.avatar ?? existing?.avatar ?? legacy?.avatar ?? fallbackAvatar,
    createdAt: account?.createdAt ?? existing?.createdAt ?? legacy?.createdAt ?? Date.now(),
    cloud: true,
    updatedAt: account?.updatedAt ?? Date.now(),
  }
  const orgId = account?.orgId ?? existing?.orgId ?? legacy?.orgId
  if (orgId) user.orgId = orgId
  const partyId = account?.partyId ?? existing?.partyId ?? legacy?.partyId
  if (partyId) user.partyId = partyId
  return user
}

/** Shared tail of a successful cloud sign-in/sign-up. */
async function completeCloudSignIn(
  uidValue: string,
  email: string,
  fallbackName: string,
  fallbackAvatar: string
): Promise<User> {
  const legacy = findLocalByEmail(email)
  const account = await fetchAccount(uidValue)
  if (legacy && legacy.id !== uidValue) adoptLocalData(legacy.id, uidValue)

  const user = upsertUser(localRecordForCloud(uidValue, email, fallbackName, fallbackAvatar, account, legacy))
  save<string | null>(SESSION_KEY, user.id)
  pushAccount(user)
  cloudSync.pushGuestProfile(user)
  // Carries an upgraded local account's history up. pushProgress unions rather
  // than overwrites, so this is safe even on a device that has none yet.
  cloudSync.pushProgress(user.id)
  cloudSync.pushBookings(user.id)
  return user
}

// ── Sign up / sign in / sign out ──────────────────────────────────────────────

export async function signUp(email: string, password: string, name: string, avatar: string): Promise<User> {
  const normalized = normalizeEmail(email)

  const cloud = await cloudSignUp(normalized, password)
  if (cloud.ok) {
    return completeCloudSignIn(cloud.uid, normalizeEmail(cloud.email), name, avatar)
  }
  if (cloud.kind === 'rejected') {
    throw new Error(cloud.message)
  }

  // Cloud unreachable — local-only account, exactly the pre-cloud behaviour.
  if (findLocalByEmail(normalized)) {
    throw new Error('An adventurer with that email already exists')
  }
  const user: User = {
    id: uid(),
    email: normalized,
    passHash: await hashPassword(password),
    name,
    avatar,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  upsertUser(user)
  save<string | null>(SESSION_KEY, user.id)
  cloudSync.pushGuestProfile(user)
  return user
}

export async function signIn(email: string, password: string): Promise<User> {
  const normalized = normalizeEmail(email)

  const cloud = await cloudSignIn(normalized, password)
  if (cloud.ok) {
    const legacy = findLocalByEmail(normalized)
    return completeCloudSignIn(
      cloud.uid,
      normalizeEmail(cloud.email),
      legacy?.name ?? (normalized.split('@')[0] || 'Adventurer'),
      legacy?.avatar ?? 'shield'
    )
  }

  const legacy = findLocalByEmail(normalized)
  const legacyMatches = !!legacy && !legacy.cloud && legacy.passHash === (await hashPassword(password))

  if (cloud.kind === 'rejected') {
    // An account made before this device had cloud accounts: the credential is
    // proven against the local hash, so mint the real Firebase account for it now.
    if (legacyMatches && legacy) {
      const promoted = await cloudSignUp(normalized, password)
      if (promoted.ok) {
        return completeCloudSignIn(promoted.uid, normalizeEmail(promoted.email), legacy.name, legacy.avatar)
      }
      // Can't mint one (provider off, offline) — the local credential still
      // checked out, so let them in locally rather than stranding the account.
      if (promoted.kind === 'unavailable') return signInLocally(legacy)
    }
    throw new Error(cloud.message)
  }

  // Cloud unreachable — fall back to the local credential check. When there is
  // no local account at all we genuinely don't know whether the credentials are
  // wrong or the account simply lives on the server, so say the honest thing
  // rather than accusing them of a bad password.
  if (!legacy) {
    throw new Error(
      isConfigured()
        ? 'Could not reach the gate. Check your connection, then try again.'
        : 'No adventurer found with those credentials'
    )
  }
  if (!legacyMatches) {
    throw new Error('No adventurer found with those credentials')
  }
  return signInLocally(legacy)
}

function signInLocally(user: User): User {
  save<string | null>(SESSION_KEY, user.id)
  cloudSync.pushGuestProfile(user)
  return user
}

export function signOut(): void {
  save<string | null>(SESSION_KEY, null)
  void cloudSignOut()
}

export function currentUser(): User | null {
  const id = load<string | null>(SESSION_KEY, null)
  if (!id) return null
  return getUser(id)
}

export function getUser(id: string): User | null {
  return getUsers().find((u) => u.id === id) ?? null
}

export function listUsers(): User[] {
  return getUsers()
}

export function updateProfile(
  userId: string,
  patch: Partial<Pick<User, 'name' | 'avatar' | 'partyId' | 'orgId'>>
): User | null {
  const users = getUsers()
  const idx = users.findIndex((u) => u.id === userId)
  if (idx === -1) return null
  const updated: User = { ...users[idx], ...patch, updatedAt: Date.now() }
  const next = [...users]
  next[idx] = updated
  setUsers(next)
  pushAccount(updated)
  cloudSync.pushGuestProfile(updated)
  return updated
}

/**
 * A cloud account's local session is only good while Firebase agrees you are
 * signed in. If the Firebase session is gone (cleared storage, revoked account)
 * we drop the local one so the guest is sent back to the gate rather than
 * writing under an anonymous uid that the rules will reject.
 *
 * Deliberately conservative: local-only accounts are never touched, and an
 * unreachable cloud is never treated as a signed-out cloud.
 */
export async function reconcileSession(): Promise<void> {
  if (!isConfigured()) return
  const user = currentUser()
  if (!user?.cloud) return
  const fb = await ensureFirebase()
  if (!fb) return
  if (hasRealAuth()) return
  save<string | null>(SESSION_KEY, null)
}
