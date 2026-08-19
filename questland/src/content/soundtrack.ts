// Questland Radio — the tracks and the shelves they sit on.
//
// THE CATALOGUE IS LIVE. Songs are documents in Firestore `radioTracks`,
// written by the ingest function when a file is dropped into the bucket's
// inbox/ (see functions/src/radioIngest.ts and docs/radio-pipeline.md), so a
// new song reaches every member without a deploy.
//
// What ships in this file is the FALLBACK, and it is consulted only when the
// live catalogue is empty — the un-seeded state, a refused read, or a first
// run with no network. The moment Firestore returns a single track, it wins
// entirely. That ordering is what makes the migration safe to deploy before
// the collection is seeded: there is no window in which the radio is blank.
//
// PLAYLISTS themselves stay in code. Their names, blurbs, order colours and
// art are design decisions, not content, and there are four of them.
// Membership rides on each TRACK (`playlistIds`) so adding a song touches one
// document and nothing else.

/** Where a track's bytes live. */
export type TrackSource =
  | { kind: 'asset'; path: string } // bundled file, relative to BASE_URL
  | { kind: 'storage'; path: string } // Cloud Storage object path, e.g. 'radio/01-name.m4a'

export interface RadioTrack {
  id: string
  title: string
  /** Seconds — shown in lists before the file has ever been loaded. */
  duration: number
  source: TrackSource
  /** Every shelf this song sits on. Always includes 'pl-woods'. */
  playlistIds: string[]
  /** Curated position. Absent sorts by title, which is the default order. */
  sortIndex?: number
  /** Cover art path relative to BASE_URL. Falls back playlist art → the Questland mark. */
  art?: string
}

export interface RadioPlaylist {
  id: string
  name: string
  /** One guild-voice line under the name. */
  blurb: string
  /** Set on the three order playlists — paints the track-colour accent. */
  orgId?: string
  art?: string
}

/** The shelf every song sits on, and the one the ingest function defaults to. */
export const FULL_SHELF_ID = 'pl-woods'

const BUNDLED_TRACKS: RadioTrack[] = [
  {
    id: 'trk-adventure-of-the-elm-instrumental',
    title: 'Adventure of the Elm — Instrumental',
    duration: 236,
    source: { kind: 'storage', path: 'radio/01-adventure-of-the-elm-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-lore'],
  },
  {
    id: 'trk-aldric-s-way-instrumental',
    title: "Aldric's Way — Instrumental",
    duration: 212,
    source: { kind: 'storage', path: 'radio/02-aldric-s-way-instrumental.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-alehiim-blessed-a-cappella',
    title: 'Alehiim Blessed — A Cappella',
    duration: 189,
    source: { kind: 'storage', path: 'radio/03-alehiim-blessed-a-cappella.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-alehiim-blessed-flutes',
    title: 'Alehiim Blessed — Flutes',
    duration: 185,
    source: { kind: 'storage', path: 'radio/04-alehiim-blessed-flutes.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-alehiim-blessed-instrumental-storybook-1',
    title: 'Alehiim Blessed — Storybook Instrumental (Alt)',
    duration: 184,
    source: { kind: 'storage', path: 'radio/05-alehiim-blessed-instrumental-storybook-1.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-alehiim-blessed-instrumental-storybook',
    title: 'Alehiim Blessed — Storybook Instrumental',
    duration: 184,
    source: { kind: 'storage', path: 'radio/06-alehiim-blessed-instrumental-storybook.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-alehiim-blessed-instrumental',
    title: 'Alehiim Blessed — Instrumental',
    duration: 188,
    source: { kind: 'storage', path: 'radio/07-alehiim-blessed-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-alehiim-blessed-skywave-1',
    title: 'Alehiim Blessed — Skywave II',
    duration: 192,
    source: { kind: 'storage', path: 'radio/08-alehiim-blessed-skywave-1.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-alehiim-blessed-skywave',
    title: 'Alehiim Blessed — Skywave',
    duration: 199,
    source: { kind: 'storage', path: 'radio/09-alehiim-blessed-skywave.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-anthem-of-the-elm-instrumental',
    title: 'Anthem of the Elm — Instrumental',
    duration: 171,
    source: { kind: 'storage', path: 'radio/10-anthem-of-the-elm-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-lore'],
  },
  {
    id: 'trk-anthem-of-the-realm',
    title: 'Anthem of the Realm',
    duration: 176,
    source: { kind: 'storage', path: 'radio/11-anthem-of-the-realm.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-find-the-way-stadium-rock-anthem',
    title: 'Find the Way — Stadium Rock Anthem',
    duration: 248,
    source: { kind: 'storage', path: 'radio/12-find-the-way-stadium-rock-anthem.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-find-the-way',
    title: 'Find the Way',
    duration: 201,
    source: { kind: 'storage', path: 'radio/13-find-the-way.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-hear-us-ancient-skywave',
    title: 'Hear Us — Ancient Skywave',
    duration: 310,
    source: { kind: 'storage', path: 'radio/14-hear-us-ancient-skywave.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-hear-us-we-hear',
    title: 'Hear Us, We Hear',
    duration: 304,
    source: { kind: 'storage', path: 'radio/15-hear-us-we-hear.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-hear-us-we-hear-instrumental',
    title: 'Hear Us, We Hear — Instrumental',
    duration: 193,
    source: { kind: 'storage', path: 'radio/16-hear-us-we-hear-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-wilds'],
  },
  {
    id: 'trk-march-of-nordad',
    title: 'March of Nordad',
    duration: 203,
    source: { kind: 'storage', path: 'radio/17-march-of-nordad.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-march-of-the-ox',
    title: 'March of the Ox',
    duration: 173,
    source: { kind: 'storage', path: 'radio/18-march-of-the-ox.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-medley-of-the-kingdom-2',
    title: 'Medley of the Kingdom II',
    duration: 243,
    source: { kind: 'storage', path: 'radio/19-medley-of-the-kingdom-2.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-medley-of-the-kingdom-3',
    title: 'Medley of the Kingdom III',
    duration: 223,
    source: { kind: 'storage', path: 'radio/20-medley-of-the-kingdom-3.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-people-of-the-leaves-chillstep-1',
    title: 'People of the Leaves — Chillstep II',
    duration: 166,
    source: { kind: 'storage', path: 'radio/21-people-of-the-leaves-chillstep-1.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-people-of-the-leaves-chillstep-2',
    title: 'People of the Leaves — Chillstep III',
    duration: 165,
    source: { kind: 'storage', path: 'radio/22-people-of-the-leaves-chillstep-2.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-people-of-the-leaves-chillstep',
    title: 'People of the Leaves — Chillstep',
    duration: 165,
    source: { kind: 'storage', path: 'radio/23-people-of-the-leaves-chillstep.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-people-of-the-leaves-pop',
    title: 'People of the Leaves — Pop',
    duration: 180,
    source: { kind: 'storage', path: 'radio/24-people-of-the-leaves-pop.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-people-of-the-leaves-summer-vibes',
    title: 'People of the Leaves — Summer Vibes',
    duration: 154,
    source: { kind: 'storage', path: 'radio/25-people-of-the-leaves-summer-vibes.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-quest-of-the-rangers',
    title: 'Quest of the Rangers',
    duration: 197,
    source: { kind: 'storage', path: 'radio/26-quest-of-the-rangers.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-ranger-way-instrumental',
    title: 'Ranger Way — Instrumental',
    duration: 220,
    source: { kind: 'storage', path: 'radio/27-ranger-way-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-ranger-s-path-instrumental',
    title: "Ranger's Path — Instrumental",
    duration: 200,
    source: { kind: 'storage', path: 'radio/28-ranger-s-path-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-rangers-skywave',
    title: 'Rangers — Skywave',
    duration: 229,
    source: { kind: 'storage', path: 'radio/29-rangers-skywave.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-rangers-in-the-wilderness-1',
    title: 'Rangers in the Wilderness (Alt)',
    duration: 175,
    source: { kind: 'storage', path: 'radio/30-rangers-in-the-wilderness-1.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-rangers-in-the-wilderness',
    title: 'Rangers in the Wilderness',
    duration: 175,
    source: { kind: 'storage', path: 'radio/31-rangers-in-the-wilderness.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-rangers-of-the-kingdom-celtic-folk',
    title: 'Rangers of the Kingdom — Celtic Folk',
    duration: 165,
    source: { kind: 'storage', path: 'radio/32-rangers-of-the-kingdom-celtic-folk.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-rangers-of-the-kingdom',
    title: 'Rangers of the Kingdom',
    duration: 170,
    source: { kind: 'storage', path: 'radio/33-rangers-of-the-kingdom.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-the-warden-of-the-kingdom-instrumental',
    title: 'The Warden of the Kingdom — Instrumental',
    duration: 290,
    source: { kind: 'storage', path: 'radio/34-the-warden-of-the-kingdom-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-the-way-of-aldric-instrumental',
    title: 'The Way of Aldric — Instrumental',
    duration: 220,
    source: { kind: 'storage', path: 'radio/35-the-way-of-aldric-instrumental.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-warden-s-path-instrumental',
    title: "Warden's Path — Instrumental",
    duration: 167,
    source: { kind: 'storage', path: 'radio/36-warden-s-path-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-way-of-the-ranger-instrumental',
    title: 'Way of the Ranger — Instrumental',
    duration: 213,
    source: { kind: 'storage', path: 'radio/37-way-of-the-ranger-instrumental.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-wisetree-final',
    title: 'Wisetree',
    duration: 278,
    source: { kind: 'storage', path: 'radio/38-wisetree-final.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-wisetree-instrumental-1',
    title: 'Wisetree — Instrumental II',
    duration: 202,
    source: { kind: 'storage', path: 'radio/39-wisetree-instrumental-1.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-wisetree-instrumental-x-rangers-of-questia-mashup',
    title: 'Wisetree × Rangers of the Kingdom — Mashup',
    duration: 290,
    source: { kind: 'storage', path: 'radio/40-wisetree-instrumental-x-rangers-of-questia-mashup.m4a' },
    playlistIds: ['pl-woods', 'pl-valor'],
  },
  {
    id: 'trk-wisetree-instrumental',
    title: 'Wisetree — Instrumental',
    duration: 283,
    source: { kind: 'storage', path: 'radio/41-wisetree-instrumental.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-wisetree-sonata-instrumental-1',
    title: 'Wisetree Sonata — Instrumental (Alt)',
    duration: 253,
    source: { kind: 'storage', path: 'radio/42-wisetree-sonata-instrumental-1.m4a' },
    playlistIds: ['pl-woods'],
  },
  {
    id: 'trk-wisetree-sonata-instrumental',
    title: 'Wisetree Sonata — Instrumental',
    duration: 253,
    source: { kind: 'storage', path: 'radio/43-wisetree-sonata-instrumental.m4a' },
    playlistIds: ['pl-woods'],
  },
]

export const PLAYLISTS: RadioPlaylist[] = [
  {
    id: FULL_SHELF_ID,
    name: 'Songs of the Kingdom',
    blurb: 'Gather every song of the park under one canopy.',
  },
  {
    id: 'pl-valor',
    name: 'Songs of Valor',
    blurb: 'The Rangers of the Kingdom march to these airs.',
    orgId: 'rangers',
    art: 'assets/badge-compass-sword.png',
  },
  {
    id: 'pl-wilds',
    name: 'Airs of the Wilds',
    blurb: 'The Hearers of the Alehiim hold these melodies close.',
    orgId: 'alehiim',
    art: 'assets/relief-pomegranate-tree-stone.png',
  },
  {
    id: 'pl-lore',
    name: 'Hymns of Lore',
    blurb: 'Measures the Order of the Realm keeps sworn.',
    orgId: 'elm',
    art: 'assets/badge-crowned-realm-gold.png',
  },
]

// ── The live catalogue ───────────────────────────────────────────────────────
//
// Same shape as every other store here (onCloudState precedent): a private
// listener set and a snapshot that is a NEW array only when something actually
// changed, so useSyncExternalStore does not re-render on every snapshot read.
//
// The localStorage mirror is what lets a KEPT song still know its own name
// with the radio off. Firestore's own cache would usually cover it, but only
// after a successful online read of that document, and a song kept months ago
// on a device that has since been offline is exactly the case that must not
// degrade to a blank row.

const CACHE_KEY = 'ql:radio:catalogue'

let live: RadioTrack[] = restoreCatalogue()
const listeners = new Set<() => void>()

/** Cheap identity for "did anything change" — avoids a deep compare per snapshot. */
function fingerprint(tracks: RadioTrack[]): string {
  return tracks
    .map((t) => `${t.id}|${t.title}|${t.duration}|${sourcePath(t)}|${t.playlistIds.join('+')}`)
    .join('\n')
}

function sourcePath(t: RadioTrack): string {
  return t.source.path
}

/** Order: curated first where given, then by title. Stable and self-maintaining. */
function order(tracks: RadioTrack[]): RadioTrack[] {
  return [...tracks].sort((a, b) => {
    const ai = a.sortIndex ?? Number.MAX_SAFE_INTEGER
    const bi = b.sortIndex ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.title.localeCompare(b.title)
  })
}

/**
 * A shape guard, not a formality: this parses whatever is in localStorage, and
 * a half-written or older-schema entry reaching the player would fail deep in
 * playback where the cause is invisible. Anything malformed is dropped here.
 */
function sane(value: unknown): value is RadioTrack {
  if (!value || typeof value !== 'object') return false
  const t = value as Partial<RadioTrack>
  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    typeof t.duration === 'number' &&
    Number.isFinite(t.duration) &&
    !!t.source &&
    typeof t.source.path === 'string' &&
    (t.source.kind === 'storage' || t.source.kind === 'asset') &&
    Array.isArray(t.playlistIds) &&
    t.playlistIds.every((p) => typeof p === 'string')
  )
}

function restoreCatalogue(): RadioTrack[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return order(parsed.filter(sane))
  } catch {
    return []
  }
}

/**
 * The catalogue in force. The cloud's if it holds anything at all, else what
 * shipped in the bundle — see the header for why that order and not the other.
 */
export function getTracks(): RadioTrack[] {
  return live.length > 0 ? live : BUNDLED_TRACKS
}

export function subscribeCatalogue(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Adopt a catalogue read from the cloud. An EMPTY array is ignored rather than
 * adopted: a refused listener and a collection nobody has seeded both arrive
 * looking exactly like "no songs", and blanking a working radio on either is a
 * far worse answer than keeping the shelf that is already playing.
 */
export function setCatalogue(next: RadioTrack[]): void {
  const clean = order(next.filter(sane))
  if (clean.length === 0) return
  if (fingerprint(clean) === fingerprint(live)) return
  live = clean
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(clean))
  } catch {
    // A full quota costs the offline mirror, never the session in hand.
  }
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      // a subscriber must never break the fan-out
    }
  })
}

export function getTrack(id: string): RadioTrack | undefined {
  return getTracks().find((t) => t.id === id)
}

export function getPlaylist(id: string): RadioPlaylist | undefined {
  return PLAYLISTS.find((p) => p.id === id)
}

/** The playlist's tracks, in shelf order. */
export function tracksFor(playlistId: string): RadioTrack[] {
  return getTracks().filter((t) => t.playlistIds.includes(playlistId))
}
