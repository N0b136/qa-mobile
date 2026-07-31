// Presenter's remote — seeds/resets a believable live-pitch demo world.
// All seeded cast users and parties use the `demo-` id prefix so reset can
// target them precisely without touching real accounts.

import type { Announcement, Flag, Party, ProgressMap, QuestLeg, User } from '../types'
import { save } from './store'
import { getUser, listUsers, updateProfile } from './authService'
import { getUserParty, leaveParty, listParties } from './partyService'
import { createBooking } from './bookingService'
import { ARRIVAL_SLOTS } from '../content/bookingTiers'
import * as notificationService from './notificationService'
import { getEpisode } from '../content/quests'
import { QUEST_START, VILLAGE_PLACE } from '../content/stationMap'
import { createSos } from './sosService'
import { clearAllThreads } from './sosChatService'
import { clearPresenceFor, seedPresence } from './presenceService'
import { clearUsesFor } from './passService'
import { clearLegsFor, runIdFor, seedLegs } from './questLogService'
import { clearDemoFlags, seedFlags, tableVersion } from './flagService'
import { clearTapMemory } from './tapService'
import { clearHealth, seedHealth } from './stationHealthService'
import type { StationHealth } from './stationHealthService'
import { allStationNos } from './hubProtocol'
import { simUid } from './hubSim'
import { clearAnnouncementsBy, seedAnnouncements } from './announcementService'
import { stationsFor } from '../content/stations'
import * as cloudSync from './cloudSync'

const USERS_KEY = 'ql:users'
const PARTIES_KEY = 'ql:parties'
const SOS_KEY = 'ql:sos'
const VANGUARD_PARTY_ID = 'demo-party-vanguard'
const LANTERN_PARTY_ID = 'demo-party-lantern'

function progressKey(userId: string): string {
  return `ql:progress:${userId}`
}

function episodeIds(prefix: string, count: number): string[] {
  const ids: string[] = []
  for (let i = 1; i <= count; i++) ids.push(`${prefix}-${String(i).padStart(2, '0')}`)
  return ids
}

function plusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const HOUR = 60 * 60 * 1000

/** Station art doubles as notice heroes — see the note at the seed call site. */
function stationArt(n: number): string {
  return `${import.meta.env.BASE_URL}assets/stations/st-${String(n).padStart(2, '0')}.webp`
}

const DEMO_NOTICES = (now: number): Announcement[] => [
  {
    id: 'demo-notice-lantern',
    eyebrow: 'Festival',
    title: 'The Lantern Rite returns',
    blurb:
      'Lake Lumen is being made ready. Bring a wish, take a lantern, and stay until the water goes dark.',
    body: [
      'On the last evening of the season the Hearers carry lanterns down to Lake Lumen, and anyone in the park may carry one with them. Wardens hand them out at the Adventurer\'s Hall from six, one to a guest, until they run out.',
      'The procession leaves the Village of Queston at half past eight and walks the west shore path. Stand anywhere along it — the far bank is quieter, and the reflection is better from there.',
      'Lanterns are floated at nine. They burn for about an hour. The Forest Tavern keeps its kitchen open until the last one goes out.',
    ].join('\n\n'),
    image: stationArt(12),
    imageAlt: 'Lanterns on the water at dusk',
    tear: 'rough',
    status: 'published',
    publishAt: now - 3 * HOUR,
    pinned: true,
    createdAt: now - 3 * HOUR,
    updatedAt: now - 3 * HOUR,
    createdBy: 'Warden Aldous',
    demo: true,
  },
  {
    id: 'demo-notice-maker',
    eyebrow: 'Notice',
    title: "Maker's Cave reopens",
    blurb:
      'The crafting benches are back in service after a week of repairs. The forge relights on Saturday.',
    body: [
      'The cave has been closed while the roof timbers were replaced. It opens again at first light on Saturday with all eight benches in service.',
      'The forge itself relights the same morning. Guides will be on hand through the weekend for anyone attempting a craft station for the first time.',
    ].join('\n\n'),
    image: stationArt(15),
    imageAlt: 'The mouth of a stone workshop cave',
    tear: 'a',
    status: 'published',
    publishAt: now - 26 * HOUR,
    createdAt: now - 26 * HOUR,
    updatedAt: now - 26 * HOUR,
    createdBy: 'Guide Wren',
    demo: true,
  },
  {
    id: 'demo-notice-raid',
    eyebrow: 'Season finale',
    title: "Brigand's Return — choose your side",
    blurb:
      'All three orders stand as one for the finale. Pick where you fight, and be at the Proving Ground by ten.',
    body: [
      'Nordad\'s army marches on the park at the season\'s end, and every order is called. The day runs in three phases: preparation through the morning, the battle itself at midday, and the victory feast after.',
      'Rangers dig the line and drill for battle. Hearers set traps and train as combat medics. The Order of the Elm goes quietly for the siege tower and Devorah\'s hidden allies.',
      'Choose your side on the day — the Wardens will take your name at the Proving Ground from ten. Come as you are; everything you need is provided.',
    ].join('\n\n'),
    image: stationArt(19),
    imageAlt: 'A muster ground beneath the ramparts',
    tear: 'b',
    status: 'published',
    publishAt: now - 3 * 24 * HOUR,
    createdAt: now - 3 * 24 * HOUR,
    updatedAt: now - 3 * 24 * HOUR,
    createdBy: 'Warden Aldous',
    demo: true,
  },
]

const CAST_USERS: User[] = [
  { id: 'demo-bracken', email: 'demo-bracken@questia.test', passHash: 'x', name: 'Bracken Hale', avatar: 'compass', createdAt: Date.now(), orgId: 'rangers' },
  { id: 'demo-wren', email: 'demo-wren@questia.test', passHash: 'x', name: 'Wren Calder', avatar: 'feather', createdAt: Date.now(), orgId: 'alehiim' },
  { id: 'demo-sable', email: 'demo-sable@questia.test', passHash: 'x', name: 'Sable Ashworth', avatar: 'trees', createdAt: Date.now(), orgId: 'elm' },
  { id: 'demo-thorn', email: 'demo-thorn@questia.test', passHash: 'x', name: 'Thorn Vale', avatar: 'swords', createdAt: Date.now(), orgId: 'rangers' },
  { id: 'demo-quill', email: 'demo-quill@questia.test', passHash: 'x', name: 'Quill Amberly', avatar: 'feather', createdAt: Date.now(), orgId: 'alehiim' },
]

// Total completed episodes per cast member: bracken 12, wren 7, sable 20, thorn 3.
const CAST_PROGRESS: Record<string, ProgressMap> = {
  'demo-bracken': { rangers: episodeIds('rg', 10), alehiim: episodeIds('ah', 2) },
  'demo-wren': { alehiim: episodeIds('ah', 7) },
  'demo-sable': { rangers: episodeIds('rg', 10), elm: episodeIds('el', 10) },
  'demo-thorn': { rangers: episodeIds('rg', 3) },
  'demo-quill': { alehiim: episodeIds('ah', 2) },
}

// ── The rack ──────────────────────────────────────────────────────────────────
//
// Twelve poles, three of them out with the parties the rest of this file stages.
// Everything else is racked, so the booth panel opens on a believable counter
// rather than an empty one.
//
// The uids are shaped like the real thing — a 7-byte NTAG213 number opening with
// NXP's `04` manufacturer byte, which is what the tags in the BOM carry. That
// matters: the uid allowlist is pure hex (`/^[0-9A-F]{8,20}$/`, rejected not
// repaired), so a memorable-looking 'SIM0000001' is not a uid at all and the
// codec is right to refuse it. `simUid` is the one place that shape is written
// down, and the demo rack and the simulator must not drift apart.

const FLAG_COUNT = 12

/** FLAG-01 · FLAG-02 · FLAG-03 — the poles the seeded parties are carrying. */
const LANTERN_FLAG = simUid(1)
const VANGUARD_FLAG = simUid(2)
const QUILL_FLAG = simUid(3)

function flagLabelFor(n: number): string {
  return `FLAG-${String(n).padStart(2, '0')}`
}

/** The whole rack, with three bindings that match the staged walks exactly. */
function demoFlags(now: number, hostId: string): Flag[] {
  const flags: Flag[] = []
  for (let n = 1; n <= FLAG_COUNT; n++) {
    flags.push({
      uid: simUid(n),
      label: flagLabelFor(n),
      status: 'racked',
      updatedAt: now,
      tableAt: now,
      demo: true,
    })
  }

  const bind = (
    uid: string,
    binding: Omit<Flag, 'uid' | 'label' | 'status' | 'updatedAt' | 'tableAt' | 'demo'>
  ) => {
    const idx = flags.findIndex((f) => f.uid === uid)
    if (idx === -1) return
    flags[idx] = { ...flags[idx], status: 'bound', ...binding }
  }

  // Lantern Circle: three stations into their second episode of the day.
  bind(LANTERN_FLAG, {
    groupId: LANTERN_PARTY_ID,
    groupName: 'Lantern Circle',
    holderId: 'demo-sable',
    memberIds: ['demo-sable', 'demo-thorn'],
    orgId: 'elm',
    episodeId: 'el-04',
    episodeNumber: 4,
    headcount: 2,
    passCode: 'QST-4KDR2M',
    boundAt: now - 200 * MIN,
    lastSeenAt: now - 4 * MIN,
    lastPlaceId: 'st-08',
  })

  // Ashen Vanguard: the host's own party, quest taken, not yet at a station.
  bind(VANGUARD_FLAG, {
    groupId: VANGUARD_PARTY_ID,
    groupName: 'Ashen Vanguard',
    holderId: 'demo-bracken',
    memberIds: [hostId, 'demo-bracken', 'demo-wren'],
    orgId: 'rangers',
    episodeId: 'rg-07',
    episodeNumber: 7,
    headcount: 3,
    passCode: 'QST-9TLW71',
    boundAt: now - 34 * MIN,
    lastSeenAt: now - 20 * MIN,
    lastPlaceId: QUEST_START.id,
  })

  // Quill walks alone — a party of one, bound at the counter minutes ago and
  // still standing in the village.
  bind(QUILL_FLAG, {
    groupId: 'solo:demo-quill',
    groupName: 'Quill Amberly',
    holderId: 'demo-quill',
    memberIds: ['demo-quill'],
    orgId: 'alehiim',
    episodeId: 'ah-03',
    episodeNumber: 3,
    headcount: 1,
    boundAt: now - 7 * MIN,
    lastSeenAt: now - 6 * MIN,
    lastPlaceId: VILLAGE_PLACE.id,
  })

  return flags
}

// ── Staged station health ─────────────────────────────────────────────────────
//
// A park that is mostly well. Three plinths are not, because a board that only
// ever shows twenty-three green rings teaches a Warden nothing and proves
// nothing on a stage: the whole argument for a cached flag table is that the
// staleness is visible, so the pitch has to be able to point at it.

/** Silverhoard Mine — alive, but holding a table from before this morning's bindings. */
const STALE_STATION_NO = 17
/** Coolcreek Stone — was reporting, stopped half an hour ago. Somebody has to walk out. */
const SILENT_STATION_NO = 5
/**
 * Story Willow — card and player both answering, and faulted anyway: it is
 * reporting a non-zero `err`.
 *
 * Staged deliberately as the ONLY fault on the board, because a seed whose one
 * ember-fault ring is a dead SD card teaches everybody watching that fault
 * means hardware — and then the plinth that merely fails every play gets walked
 * past in the park. Do not "tidy" this into an `sdOk: false` row: an error code
 * alone lighting the ring is the thing this row exists to prove.
 */
const FAULT_STATION_NO = 9

function demoHealth(now: number, parkVersion: number): Array<{ stationNo: number } & Partial<StationHealth>> {
  return allStationNos().map((stationNo) => {
    if (stationNo === STALE_STATION_NO) {
      return {
        stationNo,
        // BELOW the park's, which is the whole of what makes a station stale.
        tableVersion: parkVersion - 47 * MIN,
        lastTableSyncAt: now - 47 * MIN,
        rssi: -104,
        queueDepth: 2,
      }
    }
    if (stationNo === FAULT_STATION_NO) {
      return {
        stationNo,
        tableVersion: parkVersion,
        lastTableSyncAt: now - 12 * MIN,
        // Same string a real frame produces (`Error ${frame.err}`) — the dialog
        // prints this verbatim, so a seed in any other shape stages a line no
        // plinth in the park could ever send.
        lastError: 'Error 5',
        queueDepth: 3,
      }
    }
    if (stationNo === SILENT_STATION_NO) {
      // Nothing since then — the board ages it into silence on its own, which is
      // the only honest way to stage a station that has stopped talking.
      return { stationNo, tableVersion: parkVersion, lastHeartbeatAt: now - 31 * MIN, lastTableSyncAt: now - 95 * MIN }
    }
    return { stationNo, tableVersion: parkVersion, lastTableSyncAt: now - 12 * MIN, uptimeS: 5 * 3600 + stationNo * 37 }
  })
}

// ── Staged station records ────────────────────────────────────────────────────
//
// The log the console's records panel reads. Presence says where the cast is
// standing right now; this is how they got there — the same world told as the
// day's walks, so the panel opens with real gaps between legs rather than an
// empty table.

interface DemoGroup {
  id: string
  kind: 'party' | 'solo'
  name: string
  memberNames: string[]
  /** The member who tapped — every leg of the group is raised by their device. */
  userId: string
  byName: string
  /** The standard they are carrying. Every seeded leg came off a reader. */
  flagLabel: string
}

interface DemoQuest {
  orgId: string
  orgName: string
  episodeId: string
  episodeNumber: number
  passCode: string
  passName: string
}

const MIN = 60 * 1000

function groupFields(group: DemoGroup) {
  return {
    userId: group.userId,
    byName: group.byName,
    groupId: group.id,
    groupKind: group.kind,
    groupName: group.name,
    partySize: group.memberNames.length,
    memberNames: group.memberNames,
    flagLabel: group.flagLabel,
    demo: true as const,
  }
}

/** The gate check-in a visit opens with. */
function arrivalLeg(group: DemoGroup, at: number, quest?: DemoQuest): QuestLeg {
  const leg: QuestLeg = {
    id: `${group.id}:${VILLAGE_PLACE.id}:${at}`,
    at,
    kind: 'village',
    placeId: VILLAGE_PLACE.id,
    placeName: VILLAGE_PLACE.name,
    ...groupFields(group),
  }
  if (quest) {
    leg.orgId = quest.orgId
    leg.orgName = quest.orgName
  }
  return leg
}

/**
 * A walk: the quest taken at the chief's house, then one leg per station on the
 * episode's canon rotation. `gaps` is the minutes each station took from the
 * leg before it, so the record reads like a real party moving at real speed.
 */
function walkLegs(group: DemoGroup, quest: DemoQuest, startedAt: number, gaps: number[]): QuestLeg[] {
  const rotation = stationsFor(quest.episodeId)
  const title = getEpisode(quest.episodeId)?.title
  const shared = {
    ...groupFields(group),
    orgId: quest.orgId,
    orgName: quest.orgName,
    episodeId: quest.episodeId,
    episodeNumber: quest.episodeNumber,
    stationsTotal: rotation.length,
    passCode: quest.passCode,
    passName: quest.passName,
    runId: runIdFor(group.id, quest.orgId, quest.episodeId),
  }

  const start: QuestLeg = {
    id: `${group.id}:${QUEST_START.id}:${startedAt}`,
    at: startedAt,
    kind: 'start',
    placeId: QUEST_START.id,
    placeName: QUEST_START.name,
    legNumber: 0,
    ...shared,
  }
  if (title) start.episodeTitle = title

  const legs = [start]
  let at = startedAt
  gaps.forEach((mins, i) => {
    const station = rotation[i]
    if (!station) return
    at += mins * MIN
    const leg: QuestLeg = {
      id: `${group.id}:${station.id}:${at}`,
      at,
      kind: 'station',
      placeId: station.id,
      placeName: station.name,
      legNumber: i + 1,
      ...shared,
    }
    if (title) leg.episodeTitle = title
    if (i + 1 === rotation.length) leg.sealed = true
    legs.push(leg)
  })

  return legs
}

export async function seedDemoWorld(currentUserId: string): Promise<void> {
  // Cast — merge into ql:users, replacing any prior demo record, keeping real users.
  const castIds = new Set(CAST_USERS.map((u) => u.id))
  save(USERS_KEY, [...listUsers().filter((u) => !castIds.has(u.id)), ...CAST_USERS])

  for (const [id, map] of Object.entries(CAST_PROGRESS)) {
    save(progressKey(id), map)
  }

  // Enrich the presenting user with a believable mid-season spread.
  save(progressKey(currentUserId), {
    rangers: episodeIds('rg', 6),
    alehiim: episodeIds('ah', 3),
    elm: episodeIds('el', 1),
  })
  const user = getUser(currentUserId)
  if (user && !user.orgId) {
    updateProfile(currentUserId, { orgId: 'rangers' })
  }

  // The host must end up in exactly one party. If they're already in a real
  // party (not the demo Vanguard from a prior seed), leave it first so we
  // don't corrupt /party and leaderboard state by belonging to two at once.
  // Awaited: leaveParty now settles a cloud write before touching the local
  // mirror, and its local write would otherwise land after the seed below.
  const existingParty = getUserParty(currentUserId)
  if (existingParty && existingParty.id !== VANGUARD_PARTY_ID) {
    await leaveParty(currentUserId)
  }

  // Parties — merge, replacing the demo parties by id, keeping real ones.
  const demoParties: Party[] = [
    { id: VANGUARD_PARTY_ID, code: 'VANGRD', name: 'Ashen Vanguard', memberIds: [currentUserId, 'demo-bracken', 'demo-wren'] },
    { id: LANTERN_PARTY_ID, code: 'LANTRN', name: 'Lantern Circle', memberIds: ['demo-sable', 'demo-thorn'] },
  ]
  const demoPartyIds = new Set(demoParties.map((p) => p.id))
  save(PARTIES_KEY, [...listParties().filter((p) => !demoPartyIds.has(p.id)), ...demoParties])
  updateProfile(currentUserId, { partyId: VANGUARD_PARTY_ID })

  // Two passages: a Hero Pass good TODAY, because a quest cannot be taken
  // without one and the pitch walks straight into the park — and an Adventurer
  // Pass a few days out so My Passages shows an upcoming booking too.
  createBooking(currentUserId, {
    // Three: the Ashen Vanguard walks in on this one passage, and a passage
    // only covers the headcount it was booked for.
    tierId: 'hero',
    date: plusDays(0),
    slot: ARRIVAL_SLOTS[0],
    adults: 3,
    children: 0,
    addOnIds: [],
  })
  createBooking(currentUserId, {
    tierId: 'adventurer',
    date: plusDays(3),
    slot: ARRIVAL_SLOTS[1],
    adults: 2,
    children: 0,
    addOnIds: [],
  })

  // In-world notifications.
  notificationService.add(currentUserId, {
    type: 'event',
    title: 'Lantern Rite this weekend',
    body: 'Gather at dusk by Lake Lumen as the first lanterns take to the water.',
    icon: 'sparkles',
  })
  notificationService.add(currentUserId, {
    type: 'lore',
    title: 'A whisper from the Elderwood',
    body: 'The oldest tree stirs — those who linger past dusk may hear it speak.',
    icon: 'scroll-text',
  })

  // One open call for aid so the console has something to dispatch.
  createSos('demo-sable', 'emergency', { zoneId: 'st-06', message: 'Lost the trail past the old oak.' })

  // Put the cast on the chart so the console's stations board opens with a park
  // in motion: Lantern Circle standing at a station, and a lone Ranger who
  // checked in twenty minutes ago and so reads as en route.
  const now = Date.now()

  // The rack. LOCAL ONLY, deliberately — `flags` is a staff-write collection and
  // /demo runs as the presenting GUEST, so a push would only ever be refused.
  seedFlags(demoFlags(now, currentUserId))

  // And the plinths reporting on themselves — read off the rack that was just
  // seeded, so the park's table version and the stations' agree except where we
  // want them not to. LOCAL ONLY for the same reason and one more: station
  // health never leaves this machine at all.
  seedHealth(demoHealth(now, tableVersion()), now)

  const lantern = {
    partyId: LANTERN_PARTY_ID,
    partyName: 'Lantern Circle',
    partyMemberNames: ['Sable Ashworth', 'Thorn Vale'],
    byUserId: 'demo-sable',
    byName: 'Sable Ashworth',
    // The passage Sable presented at the chief's door — one Group Hero Pass
    // walked the whole circle in.
    passCode: 'QST-4KDR2M',
    passName: 'Group Hero Pass',
    // Every one of these check-ins came off a reader in the woods, so each row
    // names the standard it came in on — which is also what tells the console
    // it was the writer of record rather than somebody's phone.
    flagLabel: flagLabelFor(1),
  }
  // Lantern Circle is standing at a station mid-episode; Ashen Vanguard took
  // their quest at the chief's house twenty minutes ago, so they read as en
  // route; and one lone traveller has only just come through the gate.
  seedPresence([
    {
      ...lantern,
      userId: 'demo-sable',
      guestName: 'Sable Ashworth',
      kind: 'station',
      stationId: 'st-08',
      placeName: 'Songhollow Cave',
      at: now - 4 * 60 * 1000,
      orgId: 'elm',
      orgName: 'Order of the Elm',
      episodeId: 'el-04',
      episodeNumber: 4,
      episodeTitle: getEpisode('el-04')?.title,
      stationsDone: 3,
      stationsTotal: 7,
      nextStationId: 'st-21',
      nextStationName: 'ElmRoot',
    },
    {
      ...lantern,
      userId: 'demo-thorn',
      guestName: 'Thorn Vale',
      kind: 'station',
      stationId: 'st-08',
      placeName: 'Songhollow Cave',
      at: now - 4 * 60 * 1000,
      orgId: 'elm',
      orgName: 'Order of the Elm',
      episodeId: 'el-04',
      episodeNumber: 4,
      episodeTitle: getEpisode('el-04')?.title,
      stationsDone: 3,
      stationsTotal: 7,
      nextStationId: 'st-21',
      nextStationName: 'ElmRoot',
    },
    {
      userId: 'demo-bracken',
      guestName: 'Bracken Hale',
      kind: 'start',
      stationId: QUEST_START.id,
      placeName: QUEST_START.name,
      at: now - 20 * 60 * 1000,
      partyId: VANGUARD_PARTY_ID,
      partyName: 'Ashen Vanguard',
      partyMemberNames: [getUser(currentUserId)?.name ?? 'You', 'Bracken Hale', 'Wren Calder'],
      orgId: 'rangers',
      orgName: 'Rangers of Questia',
      episodeId: 'rg-07',
      episodeNumber: 7,
      episodeTitle: getEpisode('rg-07')?.title,
      stationsDone: 0,
      stationsTotal: 7,
      nextStationId: 'st-16',
      nextStationName: 'Story Oak',
      byUserId: 'demo-bracken',
      byName: 'Bracken Hale',
      passCode: 'QST-9TLW71',
      passName: 'Hero Pass',
      flagLabel: flagLabelFor(2),
    },
    {
      userId: 'demo-wren',
      guestName: 'Wren Calder',
      kind: 'start',
      stationId: QUEST_START.id,
      placeName: QUEST_START.name,
      at: now - 20 * 60 * 1000,
      partyId: VANGUARD_PARTY_ID,
      partyName: 'Ashen Vanguard',
      partyMemberNames: [getUser(currentUserId)?.name ?? 'You', 'Bracken Hale', 'Wren Calder'],
      orgId: 'rangers',
      orgName: 'Rangers of Questia',
      episodeId: 'rg-07',
      episodeNumber: 7,
      episodeTitle: getEpisode('rg-07')?.title,
      stationsDone: 0,
      stationsTotal: 7,
      nextStationId: 'st-16',
      nextStationName: 'Story Oak',
      byUserId: 'demo-bracken',
      byName: 'Bracken Hale',
      passCode: 'QST-9TLW71',
      passName: 'Hero Pass',
      flagLabel: flagLabelFor(2),
    },
    // A lone traveller who has only just come through the gate: still in the
    // village, no quest taken yet.
    {
      userId: 'demo-quill',
      guestName: 'Quill Amberly',
      kind: 'village',
      stationId: VILLAGE_PLACE.id,
      placeName: VILLAGE_PLACE.name,
      at: now - 6 * 60 * 1000,
      orgId: 'alehiim',
      orgName: 'Hearers of the Alehiim',
      episodeId: 'ah-03',
      episodeNumber: 3,
      episodeTitle: getEpisode('ah-03')?.title,
      stationsDone: 0,
      stationsTotal: 7,
      nextStationName: 'The Chief’s House',
      byUserId: 'demo-quill',
      byName: 'Quill Amberly',
      flagLabel: flagLabelFor(3),
    },
  ])

  // The day's log behind all of that. Lantern Circle came through the gate three
  // hours ago and is on their second episode; the Vanguard arrived half an hour
  // ago and has just taken its quest; Quill has only walked through the gate.
  // The station places and order come off the canon rotations, so the records
  // and the park board agree with each other.
  const lanternGroup: DemoGroup = {
    id: LANTERN_PARTY_ID,
    kind: 'party',
    name: 'Lantern Circle',
    memberNames: ['Sable Ashworth', 'Thorn Vale'],
    userId: 'demo-sable',
    byName: 'Sable Ashworth',
    flagLabel: flagLabelFor(1),
  }
  const vanguardGroup: DemoGroup = {
    id: VANGUARD_PARTY_ID,
    kind: 'party',
    name: 'Ashen Vanguard',
    memberNames: [getUser(currentUserId)?.name ?? 'You', 'Bracken Hale', 'Wren Calder'],
    userId: 'demo-bracken',
    byName: 'Bracken Hale',
    flagLabel: flagLabelFor(2),
  }
  const quillGroup: DemoGroup = {
    id: 'demo-quill',
    kind: 'solo',
    name: 'Quill Amberly',
    memberNames: ['Quill Amberly'],
    userId: 'demo-quill',
    byName: 'Quill Amberly',
    flagLabel: flagLabelFor(3),
  }
  const elmQuest = { orgId: 'elm', orgName: 'Order of the Elm', passCode: 'QST-4KDR2M', passName: 'Group Hero Pass' }
  const rangersQuest = { orgId: 'rangers', orgName: 'Rangers of Questia', passCode: 'QST-9TLW71', passName: 'Hero Pass' }

  seedLegs([
    arrivalLeg(lanternGroup, now - 195 * MIN, { ...elmQuest, episodeId: 'el-03', episodeNumber: 3 }),
    // Sealed earlier in the day — a whole episode, end to end.
    ...walkLegs(
      lanternGroup,
      { ...elmQuest, episodeId: 'el-03', episodeNumber: 3 },
      now - 190 * MIN,
      [9, 11, 8, 14, 10, 12, 9]
    ),
    // And three stations into the next one, which is where the board has them.
    ...walkLegs(
      lanternGroup,
      { ...elmQuest, episodeId: 'el-04', episodeNumber: 4 },
      now - 64 * MIN,
      [18, 22, 20]
    ),
    arrivalLeg(vanguardGroup, now - 32 * MIN, { ...rangersQuest, episodeId: 'rg-07', episodeNumber: 7 }),
    ...walkLegs(vanguardGroup, { ...rangersQuest, episodeId: 'rg-07', episodeNumber: 7 }, now - 20 * MIN, []),
    arrivalLeg(quillGroup, now - 6 * MIN),
  ])

  // Publish the cast to the console's guest roster. save(USERS_KEY, ...) never
  // triggers a guest push, so without this the roster would never see them.
  // Runs last so pushGuestProfile derives the right level (progress saved above)
  // and party (party saved above). The `demo-` id prefix tags them demo:true.
  for (const u of CAST_USERS) {
    cloudSync.pushGuestProfile(u)
  }

  // Three notices on the board, so Happenings has something to read during the
  // pitch. Heroes point at bundled station art rather than a data URL — a seed
  // has no file to drop, and the field is just an <img> src either way.
  seedAnnouncements(DEMO_NOTICES(now))

  // NOTE: this used to seed a sample scheduled send. Scheduling is a staff
  // power now and /demo runs as the presenting GUEST, so the write would be
  // refused. Queue one from the console's Compose > Later tab instead.
}

export function resetDemoData(currentUserId: string): void {
  save(USERS_KEY, listUsers().filter((u) => !u.id.startsWith('demo-')))

  Object.keys(localStorage).forEach((k) => {
    if (
      /^ql:progress:demo-/.test(k) ||
      /^ql:notifications:demo-/.test(k) ||
      /^ql:stations:demo-/.test(k) ||
      /^ql:passUses:demo-/.test(k)
    ) {
      localStorage.removeItem(k)
    }
  })

  // Chat threads are swept WHOLESALE, not by the demo- prefix like everything
  // above. A thread is keyed `ql:sosChat:${uid()}` off the call's random id, so
  // it carries no marker saying whose it was and the prefix test cannot see it;
  // the sos rows themselves are cleared just below, which would otherwise leave
  // every transcript orphaned in localStorage with nothing able to reach it.
  clearAllThreads()

  // Take everybody off the chart, cast and host alike, and wipe the passage
  // ledger with the bookings it draws on — otherwise a reseeded world would
  // start with quests already paid for.
  clearPresenceFor([...CAST_USERS.map((u) => u.id), currentUserId])
  clearUsesFor([...CAST_USERS.map((u) => u.id), currentUserId])
  clearLegsFor([...CAST_USERS.map((u) => u.id), currentUserId])
  // Staged notices only — a real one posted from the console stays up.
  clearAnnouncementsBy('demo-notice-')

  // The rack, and the tap ring behind it. LOCAL ONLY: `flags` is staff-write and
  // this runs as the presenting guest, so there is nothing in the cloud for it
  // to clear — a push would only be refused. The ring goes too, because a reseed
  // reuses both the uids and the stations' sequence counters, and a stale ring
  // would make the first replayed tap of the next demo look like a duplicate.
  clearDemoFlags()
  clearTapMemory()
  // The staged board goes with the rack it was staged against. Not restored to
  // "all live" — an empty health map is `unknown` everywhere, which is the true
  // reading for a console that has just been told to forget the park.
  clearHealth()

  const user = getUser(currentUserId)
  save(PARTIES_KEY, listParties().filter((p) => !p.id.startsWith('demo-')))
  if (user?.partyId?.startsWith('demo-')) {
    updateProfile(currentUserId, { partyId: '' })
  }

  save(progressKey(currentUserId), {})
  save(`ql:stations:${currentUserId}`, {})
  save(`ql:bookings:${currentUserId}`, [])
  save(`ql:notifications:${currentUserId}`, [])

  save(SOS_KEY, [])

  // Clear the cloud mirror: demo SOS/notification/guest docs + the host's own
  // comm docs + the entire scheduled queue. Fire-and-forget; no-op offline.
  void cloudSync.deleteDemoCommDocs(currentUserId)
}
