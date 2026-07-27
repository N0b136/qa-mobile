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
import { createSos } from './sosService'
import { clearPresenceFor, seedPresence } from './presenceService'
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
]

// Total completed episodes per cast member: bracken 12, wren 7, sable 20, thorn 3.
const CAST_PROGRESS: Record<string, ProgressMap> = {
  'demo-bracken': { rangers: episodeIds('rg', 10), alehiim: episodeIds('ah', 2) },
  'demo-wren': { alehiim: episodeIds('ah', 7) },
  'demo-sable': { rangers: episodeIds('rg', 10), elm: episodeIds('el', 10) },
  'demo-thorn': { rangers: episodeIds('rg', 3) },
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

  // A confirmed upcoming booking so Bookings/Home have something to show.
  createBooking(currentUserId, {
    tierId: 'hero',
    date: plusDays(3),
    slot: ARRIVAL_SLOTS[0],
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
  seedPresence([
    {
      userId: 'demo-sable',
      guestName: 'Sable Ashworth',
      stationId: 'st-06',
      at: now - 4 * 60 * 1000,
      partyId: LANTERN_PARTY_ID,
      partyName: 'Lantern Circle',
      partyMemberNames: ['Sable Ashworth', 'Thorn Vale'],
      orgId: 'elm',
      byUserId: 'demo-sable',
      byName: 'Sable Ashworth',
    },
    {
      userId: 'demo-thorn',
      guestName: 'Thorn Vale',
      stationId: 'st-06',
      at: now - 4 * 60 * 1000,
      partyId: LANTERN_PARTY_ID,
      partyName: 'Lantern Circle',
      partyMemberNames: ['Sable Ashworth', 'Thorn Vale'],
      orgId: 'rangers',
      byUserId: 'demo-sable',
      byName: 'Sable Ashworth',
    },
    {
      userId: 'demo-bracken',
      guestName: 'Bracken Hale',
      stationId: 'st-11',
      at: now - 22 * 60 * 1000,
      partyId: VANGUARD_PARTY_ID,
      partyName: 'Ashen Vanguard',
      partyMemberNames: [getUser(currentUserId)?.name ?? 'You', 'Bracken Hale', 'Wren Calder'],
      orgId: 'rangers',
      byUserId: 'demo-bracken',
      byName: 'Bracken Hale',
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
      /^ql:stations:demo-/.test(k)
    ) {
      localStorage.removeItem(k)
    }
  })

  // Take everybody off the chart, cast and host alike.
  clearPresenceFor([...CAST_USERS.map((u) => u.id), currentUserId])

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
