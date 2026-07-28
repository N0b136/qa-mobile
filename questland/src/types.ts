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
  /**
   * The passage this walk was taken on. A quest costs one Quest Experience off
   * a passage, so the Back Office can see which one paid for the party in front
   * of it without opening anybody's bookings.
   */
  passCode?: string
  passName?: string
  /**
   * The guests that passage actually paid for. A passage covers its booked
   * headcount, so a larger party can walk in together while the guests beyond
   * the count still owe the chief a passage of their own — this is how their
   * phones tell which case they are in.
   */
  passCovers?: string[]
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

/**
 * One check-in, kept forever.
 *
 * Presence answers "where is this party NOW" and is overwritten on every
 * check-in; this is the other half — the record of the walk itself, appended
 * and never revised. A leg is written once per check-in EVENT, by the device
 * that tapped, and carries the party it walked in with, so the day's log reads
 * as parties and quests rather than as individual guests.
 *
 * This is the operations record: what the times between legs say about the flow
 * of the park is the whole reason it is kept.
 */
export interface QuestLeg {
  /** `${groupId}:${placeId}:${at}` — stable, so a re-sync can never double it. */
  id: string
  at: number
  /** The guest whose device recorded it — the one who tapped. */
  userId: string
  byName: string
  /** The party, or the lone guest walking as a party of one. */
  groupId: string
  groupKind: 'party' | 'solo'
  groupName: string
  partySize: number
  memberNames: string[]
  kind: PresenceKind
  placeId: string
  placeName: string
  orgId?: string
  orgName?: string
  episodeId?: string
  episodeNumber?: number
  episodeTitle?: string
  /** 0 at the chief's house, then the station's ordinal in the episode. */
  legNumber?: number
  stationsTotal?: number
  /** True when this leg sealed the episode. */
  sealed?: boolean
  passCode?: string
  passName?: string
  /** group + order + episode — the walk this leg belongs to. Unset at the gate. */
  runId?: string
  /** Staged by the presenter's demo remote, so a reset can find it. */
  demo?: true
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
