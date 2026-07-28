// Presenter's remote — seeds/resets a believable live-pitch demo world.
// All seeded cast users and parties use the `demo-` id prefix so reset can
// target them precisely without touching real accounts.

import type { Party, ProgressMap, User } from '../types'
import { save } from './store'
import { getUser, listUsers, updateProfile } from './authService'
import { getUserParty, leaveParty, listParties } from './partyService'
import { createBooking } from './bookingService'
import { ARRIVAL_SLOTS } from '../content/bookingTiers'
import * as notificationService from './notificationService'
import { getEpisode } from '../content/quests'
import { QUEST_START, VILLAGE_PLACE } from '../content/stationMap'
import { createSos } from './sosService'
import { clearPresenceFor, seedPresence } from './presenceService'
import { clearUsesFor } from './passService'
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
      stationId: 'st-06',
      placeName: "Brigand's Hideout",
      at: now - 4 * 60 * 1000,
      orgId: 'elm',
      orgName: 'Order of the Elm',
      episodeId: 'el-04',
      episodeNumber: 4,
      episodeTitle: getEpisode('el-04')?.title,
      stationsDone: 3,
      stationsTotal: 7,
      nextStationId: 'st-12',
      nextStationName: 'Shadetree Hollow',
    },
    {
      ...lantern,
      userId: 'demo-thorn',
      guestName: 'Thorn Vale',
      kind: 'station',
      stationId: 'st-06',
      placeName: "Brigand's Hideout",
      at: now - 4 * 60 * 1000,
      orgId: 'elm',
      orgName: 'Order of the Elm',
      episodeId: 'el-04',
      episodeNumber: 4,
      episodeTitle: getEpisode('el-04')?.title,
      stationsDone: 3,
      stationsTotal: 7,
      nextStationId: 'st-12',
      nextStationName: 'Shadetree Hollow',
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
    },
  ])

  // Publish the cast to the console's guest roster. save(USERS_KEY, ...) never
  // triggers a guest push, so without this the roster would never see them.
  // Runs last so pushGuestProfile derives the right level (progress saved above)
  // and party (party saved above). The `demo-` id prefix tags them demo:true.
  for (const u of CAST_USERS) {
    cloudSync.pushGuestProfile(u)
  }

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

  // Take everybody off the chart, cast and host alike, and wipe the passage
  // ledger with the bookings it draws on — otherwise a reseeded world would
  // start with quests already paid for.
  clearPresenceFor([...CAST_USERS.map((u) => u.id), currentUserId])
  clearUsesFor([...CAST_USERS.map((u) => u.id), currentUserId])

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
