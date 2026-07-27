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

/** episodeId -> station ids checked in on that episode */
export type StationMap = Record<string, string[]>

/** Gate arrival (the village), the chief's house, or a station on the trail. */
export type PresenceKind = 'village' | 'start' | 'station'

/**
 * Where a guest last checked in, and what walk they are on.
 *
 * One record per guest — a check-in overwrites the previous one, because a
 * guest is only ever in one place. Freshness, not a separate field, decides
 * whether they read as AT the place or EN ROUTE: inside the place's window they
 * are there, after that they are somewhere on the paths (we never track precise
 * locations). A village arrival has no window — they stay in Queston until they
 * take a quest.
 *
 * The record also carries the walk itself — order, episode, stations sealed,
 * and the station they are heading for — so the console and a guest's own party
 * can read all of it from this one document, without reaching into anybody
 * else's progress.
 */
export interface Presence {
  userId: string
  guestName: string
  kind: PresenceKind
  /** Station id, the chief's house id, or 'village'. */
  stationId: string
  /** Human name of that place, so a reader never needs the content tables. */
  placeName?: string
  /** When the check-in happened, in ms. */
  at: number
  /** The order whose questline this walk belongs to. */
  orgName?: string
  episodeId?: string
  episodeNumber?: number
  episodeTitle?: string
  /** Stations of that episode sealed so far, and how many it takes. */
  stationsDone?: number
  stationsTotal?: number
  /** Where they are headed next on the rotation. */
  nextStationId?: string
  nextStationName?: string
  partyId?: string
  partyName?: string
  /**
   * The party roster as it stood at check-in, carried in the record itself so
   * the console can name a whole party from the one doc its phone wrote —
   * rather than waiting for every member's device to report in separately.
   */
  partyMemberNames?: string[]
  orgId?: string
  /**
   * True when this check-in was the last station of the episode. Once its
   * fifteen minutes are up the guest leaves the board entirely rather than
   * reading as en route — they finished the questline, they are not walking
   * between stations.
   */
  final?: boolean
  /** The party member who actually tapped in — the rest are carried along. */
  byUserId?: string
  byName?: string
}

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
