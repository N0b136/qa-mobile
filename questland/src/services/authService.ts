import type { User } from '../types'
import { load, save } from './store'
import { uid } from './ids'
import * as cloudSync from './cloudSync'

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

export async function signUp(email: string, password: string, name: string, avatar: string): Promise<User> {
  const users = getUsers()
  const normalized = normalizeEmail(email)
  if (users.some((u) => normalizeEmail(u.email) === normalized)) {
    throw new Error('An adventurer with that email already exists')
  }
  const passHash = await hashPassword(password)
  const user: User = {
    id: uid(),
    email: normalized,
    passHash,
    name,
    avatar,
    createdAt: Date.now(),
  }
  setUsers([...users, user])
  save<string | null>(SESSION_KEY, user.id)
  cloudSync.pushGuestProfile(user)
  return user
}

export async function signIn(email: string, password: string): Promise<User> {
  const normalized = normalizeEmail(email)
  const passHash = await hashPassword(password)
  const user = getUsers().find((u) => normalizeEmail(u.email) === normalized && u.passHash === passHash)
  if (!user) {
    throw new Error('No adventurer found with those credentials')
  }
  save<string | null>(SESSION_KEY, user.id)
  cloudSync.pushGuestProfile(user)
  return user
}

export function signOut(): void {
  save<string | null>(SESSION_KEY, null)
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
  const updated: User = { ...users[idx], ...patch }
  const next = [...users]
  next[idx] = updated
  setUsers(next)
  cloudSync.pushGuestProfile(updated)
  return updated
}
