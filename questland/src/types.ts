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
  /**
   * A group enrolled at the ticket booth with no phone between them — ONE record
   * for the whole party, the bodies riding in the party's headcount. It has no
   * credential and can never be signed into, so it is kept off the leaderboard:
   * a record nobody can open has no business ranking above guests who can.
   */
  walkUp?: true
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
  /**
   * The standard this check-in came in on — 'FLAG-07'.
   *
   * Set only when a party tapped a flagpole against a station's reader. Under
   * the canopy no phone saw that tap, so the console is the writer of record for
   * it, and this is what says so on the row.
   */
  flagLabel?: string
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
  /**
   * 0 at the chief's house, then the station's ordinal in the episode.
   *
   * DELIBERATELY UNSET on a leg that earned nothing: a station off the episode's
   * rotation is a real visit but not the Nth station of anything, and giving it
   * the previous number would put two rows in the export both claiming
   * "Station 4". `offRotation` is the column that explains the gap.
   */
  legNumber?: number
  stationsTotal?: number
  /** True when this leg sealed the episode. */
  sealed?: boolean
  /** The standard the party walked in on — 'FLAG-07'. Unset on an app check-in. */
  flagLabel?: string
  /** True when the place was not on this episode's rotation, so nothing was credited. */
  offRotation?: true
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

export type FlagStatus = 'racked' | 'bound' | 'sealed' | 'lost' | 'retired'

/**
 * A flagpole — the standard a party carries through the park.
 *
 * The tag potted in its tip carries nothing but a factory uid, so THIS record is
 * the whole binding between a pole, a party and one episode, and holding a bound
 * pole is the proof the Passage was paid. Every station in the woods runs on a
 * cached copy of it, which is why the write that changes the broadcast is
 * distinguished from every other write: `updatedAt` moves on any change,
 * `tableAt` moves only on one the stations must hear about. A tap bumps
 * `updatedAt` and never `tableAt` — otherwise every tap would mark all 21
 * stations stale.
 */
export interface Flag {
  /** Doc id: RFID factory uid, uppercase hex, no separators. */
  uid: string
  /** Printed on the pole. 'FLAG-07'. */
  label: string
  /**
   * The pole is real, printed and racked, but no RFID tag has been potted into
   * its tip yet — the normal state before opening day, and where a pole lands
   * again when a tag dies under a perfectly good standard.
   *
   * `uid` is then a SYNTHETIC id minted by `flagService`, distinguishable from
   * a factory uid by its length (see `mintPendingUid`). The pole binds, spends a
   * Passage and walks like any other; the one thing it cannot do is be tapped at
   * a plinth. `flagService.attachTag` gives it a real tag later, which changes
   * this document's id and clears this field.
   */
  tagPending?: true
  status: FlagStatus
  /** Party id, or `solo:${userId}` — the key occupants() groups on. */
  groupId?: string
  groupName?: string
  /** The guest checkIn() is called as. Always one of `memberIds`. */
  holderId?: string
  memberIds?: string[]
  orgId?: string
  episodeId?: string
  episodeNumber?: number
  /** Walk-ups: bodies under one flag, when that is more than the roster. */
  headcount?: number
  /** The Passage spent to bind it — the receipt. */
  passCode?: string
  /** Staff uid only — deliberately never a staff NAME. */
  boundBy?: string
  boundAt?: number
  /**
   * An administrative undo: the binding was wrong and was taken back. A walk
   * that ended properly stamps `checkedOutAt` instead, and the two must never
   * be merged — one says "mis-scan", the other says "they went home".
   */
  releasedAt?: number
  /** The pole was handed back at the booth. This is what closes a walk. */
  checkedOutAt?: number
  /** Last tap. Bumps `updatedAt`, NEVER `tableAt`. */
  lastSeenAt?: number
  lastPlaceId?: string
  /** Any write. Drives merge last-write-wins. */
  updatedAt: number
  /** The last write that changed what the stations broadcast. */
  tableAt: number
  /** Staged by the presenter's demo remote, so a reset can find it. */
  demo?: true
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

/**
 * A notice pinned to the board — what the guest reads under "Happenings".
 *
 * Written by the Back Office console and read by every phone, so it is a
 * staff-authored document rather than something a guest owns. The card shows
 * the hero, the title and the `blurb`; `body` is the whole post, and only opens
 * when the guest taps "…see more".
 *
 * `image` is a plain <img> src. The console stores a downscaled data URL there
 * so a notice needs no file host and survives offline in the local mirror; a
 * seeded notice can point at a bundled asset path instead. Either works.
 */
export interface Announcement {
  id: string
  /** Small gold label above the title — 'Festival', 'Notice', a date. */
  eyebrow?: string
  title: string
  /** The teaser on the card. Kept short; the card truncates past ~3 lines. */
  blurb: string
  /** The whole post, shown in the dialog. Blank lines separate paragraphs. */
  body: string
  image?: string
  imageAlt?: string
  /** Torn-edge variant, so a column of notices doesn't look stamped. */
  tear?: 'a' | 'b' | 'c' | 'rough'
  status: 'published' | 'draft'
  /** ms — when it goes up on the board. A future stamp holds it back. */
  publishAt: number
  /** ms — when it comes down. Unset means it stays. */
  expiresAt?: number
  /** Rides above the rest of the board. */
  pinned?: boolean
  createdAt: number
  updatedAt: number
  /** The staff member who posted it. */
  createdBy?: string
  /** Staged by the presenter's demo remote, so a reset can find it. */
  demo?: true
}

export interface ChatMessage {
  id: string
  from: 'guest' | 'staff'
  text: string
  at: number
}

// ── Hub wire types ──────────────────────────────────────────────────────────
//
// A station in the woods talks to the hub over LoRa. The hub sits on the
// console PC's USB port and relays the whole park as newline-delimited JSON —
// one object per line, nothing else on the line. These are the frames AS THEY
// APPEAR ON THAT WIRE, and they are the only shape `hubProtocol` will hand out
// or accept.
//
// WIRE INVARIANT (from the plan, and the reason this surface is safe): nothing
// on the air is free text. Every field below is a hex uid, a small enum letter,
// or a bounded integer — no names, no messages, no free-form strings. The first
// person who wants a station to greet a party by name will propose putting a
// party name in the flag table; that is the change this invariant exists to
// stop. A frame carrying an unescaped delimiter or an out-of-range index is
// dropped by `decodeLine`, never repaired.
//
// Field names are short because they cross a 115200-baud link and, in the
// firmware, a 255-byte LoRa payload. Key ORDER here is canonical — `encodeLine`
// emits keys in exactly this order so a simulated hub and a real one produce
// byte-identical lines.

/** LoRa `T` TAP result: resolved Locally · Queried the hub · Unresolved. */
export type HubTapResult = 'L' | 'Q' | 'U'

/** LoRa `C`/`K` CMD verbs. No REBOOT/WIPEQ in v1 — deliberately. */
export type HubCommand = 'VOL' | 'QVOL' | 'PLAY' | 'SYNC' | 'PING'

/** A flag as the hub and each station cache it. NO group identity on the air. */
export interface HubTableRow {
  /** RFID factory uid, uppercase hex, no separators. */
  uid: string
  /** Audio folder: 0 unknown · 1 Rangers · 2 Alehiim · 3 Elm · 4 RAID. */
  org: number
  /** Audio track = episode number. 0 when unknown. */
  ep: number
  /** 0 assigned · 1 sealed · 2 returned. */
  state: number
  partySize: number
}

/** A guest tapped a standard on a station's reader. */
export interface HubTapFrame {
  t: 'tap'
  /** 1..21 stations · 22 chief · 23 gate. RANGE-CHECKED before it indexes anything. */
  st: number
  uid: string
  /** Station's NVS sequence counter — the L1 dedupe key is `${st}:${seq}`. */
  seq: number
  /** Station clock, epoch seconds, taken from the beacon's EPOCH. */
  ts: number
  org: number
  ep: number
  res: HubTapResult
}

/** A tag read on the booth pad at the gate. Bind at one end of a walk, check out at the other. */
export interface HubBoothFrame {
  t: 'booth'
  uid: string
  ts: number
}

/** LoRa `H` HB, one per station per 120 s TDMA frame. */
export interface HubHeartbeatFrame {
  t: 'hb'
  st: number
  /** Uptime, seconds. */
  ups: number
  /** The flag-table version this station HOLDS. */
  tblver: number
  /** Seconds since this station last COMMITTED a table — the staleness window, made visible. */
  tblage: number
  /** Unsent taps in its NVS ring. */
  qd: number
  sd: 0 | 1
  df: 0 | 1
  /** Numeric error code, never free text. 0 = none. */
  err: number
  rssi: number
  vol: number
  fw: number
}

/** LoRa `Q` QUERY — a station holding no row for a tapped uid. It stays on ambience until answered. */
export interface HubQueryFrame {
  t: 'query'
  st: number
  uid: string
  seq: number
}

/** LoRa `L` LOG — numeric level, numeric code, numeric args. Never free text. */
export interface HubLogFrame {
  t: 'log'
  st: number
  lvl: number
  code: number
  a1: number
  a2: number
}

/** The hub introducing itself over USB, and on every table commit. */
export interface HubStatusFrame {
  t: 'hub'
  fw: number
  /** The table version the HUB holds — what it is broadcasting to the park. */
  tblver: number
  /** Stations it has heard from since boot. */
  stations: number
  up: number
}

/** Console → hub. One chunk of the flag table; mirrors the LoRa `U` CHUNK frame. */
export interface HubTableFrame {
  t: 'table'
  ver: number
  idx: number
  of: number
  rows: HubTableRow[]
}

/** Console → hub. A single binding changed — cheaper than a whole table. */
export interface HubRowFrame {
  t: 'row'
  ver: number
  row: HubTableRow
}

/** Console → hub → station. The answer to a `query`; mirrors the LoRa `R` RESOLVE frame. */
export interface HubResolveFrame {
  t: 'resolve'
  st: number
  uid: string
  org: number
  ep: number
  state: number
  /** Seconds this row may be cached. */
  ttl: number
}

/** Console → hub → station. */
export interface HubCmdFrame {
  t: 'cmd'
  st: number
  cmd: HubCommand
  arg: number
}

/** Hub → console. The only frames the console ever receives. */
export type HubInboundFrame =
  | HubTapFrame
  | HubBoothFrame
  | HubHeartbeatFrame
  | HubQueryFrame
  | HubLogFrame
  | HubStatusFrame

/** Console → hub. The only frames the console ever sends. */
export type HubOutboundFrame = HubTableFrame | HubRowFrame | HubResolveFrame | HubCmdFrame

export type HubFrame = HubInboundFrame | HubOutboundFrame

export type HubFrameType = HubFrame['t']
