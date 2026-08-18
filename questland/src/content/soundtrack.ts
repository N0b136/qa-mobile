// Questland Radio — the tracks and the shelves they sit on.
//
// v1 ships four generated demo loops (scripts/gen-demo-tracks.mjs) bundled as
// public assets. Real songs land in Cloud Storage later: flip each track's
// source to { kind: 'storage', path: 'radio/NN-slug.m4a' } and NOTHING else in
// the app changes — see docs/radio-pipeline.md. Copy here is placeholder until
// the content pass.

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
  trackIds: string[]
}

export const TRACKS: RadioTrack[] = [
  {
    id: 'trk-woods',
    title: 'Under the Whispering Boughs',
    duration: 44,
    source: { kind: 'asset', path: 'assets/audio/demo-woods.wav' },
  },
  {
    id: 'trk-valor',
    title: 'March of the Rangers',
    duration: 42,
    source: { kind: 'asset', path: 'assets/audio/demo-valor.wav' },
  },
  {
    id: 'trk-wilds',
    title: 'Air of the Alehiim',
    duration: 44,
    source: { kind: 'asset', path: 'assets/audio/demo-wilds.wav' },
  },
  {
    id: 'trk-lore',
    title: 'The Realm Remembers',
    duration: 46,
    source: { kind: 'asset', path: 'assets/audio/demo-lore.wav' },
  },
]

export const PLAYLISTS: RadioPlaylist[] = [
  {
    id: 'pl-woods',
    name: 'The Whispering Woods',
    blurb: 'Gather every song of the park under one canopy.',
    trackIds: ['trk-woods', 'trk-valor', 'trk-wilds', 'trk-lore'],
  },
  {
    id: 'pl-valor',
    name: 'Songs of Valor',
    blurb: 'The Rangers of the Kingdom march to these airs.',
    orgId: 'rangers',
    art: 'assets/badge-compass-sword.png',
    trackIds: ['trk-valor'],
  },
  {
    id: 'pl-wilds',
    name: 'Airs of the Wilds',
    blurb: 'The Hearers of the Alehiim hold these melodies close.',
    orgId: 'alehiim',
    art: 'assets/relief-pomegranate-tree-stone.png',
    trackIds: ['trk-wilds'],
  },
  {
    id: 'pl-lore',
    name: 'Hymns of Lore',
    blurb: 'Measures the Order of the Realm keeps sworn.',
    orgId: 'elm',
    art: 'assets/badge-crowned-realm-gold.png',
    trackIds: ['trk-lore'],
  },
]

export function getTrack(id: string): RadioTrack | undefined {
  return TRACKS.find((t) => t.id === id)
}

export function getPlaylist(id: string): RadioPlaylist | undefined {
  return PLAYLISTS.find((p) => p.id === id)
}

/** The playlist's tracks, in shelf order. Unknown ids are dropped, not thrown. */
export function tracksFor(playlistId: string): RadioTrack[] {
  const pl = getPlaylist(playlistId)
  if (!pl) return []
  return pl.trackIds.map((id) => getTrack(id)).filter((t): t is RadioTrack => !!t)
}
