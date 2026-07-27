// Domain types for Questland app state (users, progress, bookings, etc).
// These mirror future Firestore collections — keep shapes flat and serializable.

export interface User {
  id: string
  /** '' on directory shells mirrored from other devices — emails are never public. */
  email: string
  /** Local-only accounts hold a hash here; cloud accounts leave it unset (Firebase Auth owns the credential). */
  passHash?: string
  name: string
  avatar: string
  createdAt: number
  partyId?: string
  /** Starting Questline chosen at onboarding; all three questlines remain open. */
  orgId?: string
  /** True when `id` is a Firebase Auth uid and the account is validated server-side. */
  cloud?: boolean
  /** True on read-only shells mirrored from the cloud guest directory (other people). */
  remote?: boolean
  /** Last local edit, in ms — drives last-write-wins against the cloud profile. */
  updatedAt?: number
}

/** orgId -> completed episodeIds */
export type ProgressMap = Record<string, string[]>

export interface Booking {
  id: string
  userId: string
  tierId: string
  /** yyyy-mm-dd */
  date: string
  slot: string
  adults: number
  children: number
  addOnIds: string[]
  total: number
  status: 'confirmed' | 'cancelled'
  code: string
  createdAt: number
  /** Last change, in ms — drives last-write-wins when the same booking syncs from two devices. */
  updatedAt?: number
}

export type NotificationType = 'event' | 'booking' | 'lore' | 'system' | 'sos'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  icon?: string
  read: boolean
  createdAt: number
}

export interface Party {
  id: string
  code: string
  name: string
  memberIds: string[]
  /** True when the party is registered in Firestore and its code is globally unique. */
  cloud?: boolean
  createdAt?: number
  updatedAt?: number
}

export type SosKind = 'emergency' | 'quest-help'
export type SosStatus = 'open' | 'acknowledged' | 'resolved'

export interface SosRequest {
  id: string
  userId: string
  kind: SosKind
  zoneId?: string
  message?: string
  status: SosStatus
  responder?: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  from: 'guest' | 'staff'
  text: string
  at: number
}
