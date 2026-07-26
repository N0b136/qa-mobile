// Domain types for Questland app state (users, progress, bookings, etc).
// These mirror future Firestore collections — keep shapes flat and serializable.

export interface User {
  id: string
  email: string
  passHash: string
  name: string
  avatar: string
  createdAt: number
  partyId?: string
  /** Starting Questline chosen at onboarding; all three questlines remain open. */
  orgId?: string
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
