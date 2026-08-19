// Questland Radio — the tracks and the shelves they sit on.
//
// The park's real soundtrack: 43 songs, 2h30m, encoded by
// scripts/encode-songs.mjs (two-pass EBU R128 loudnorm → 128 kbps AAC) and
// uploaded to Cloud Storage under radio/. `path` is the Storage object path
// VERBATIM — renaming an object in the bucket breaks its track and nothing
// else will tell you. See docs/radio-pipeline.md.
//
// Titles are the park's own; the encoder only slugified the filenames, so the
// apostrophes ("Aldric's Way") and variant labels are restored by hand here.

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
    id: 'trk-adventure-of-the-elm-instrumental',
    title: 'Adventure of the Elm — Instrumental',
    duration: 236,
    source: { kind: 'storage', path: 'radio/01-adventure-of-the-elm-instrumental.m4a' },
  },
  {
    id: 'trk-aldric-s-way-instrumental',
    title: "Aldric's Way — Instrumental",
    duration: 212,
    source: { kind: 'storage', path: 'radio/02-aldric-s-way-instrumental.m4a' },
  },
  {
    id: 'trk-alehiim-blessed-a-cappella',
    title: 'Alehiim Blessed — A Cappella',
    duration: 189,
    source: { kind: 'storage', path: 'radio/03-alehiim-blessed-a-cappella.m4a' },
  },
  {
    id: 'trk-alehiim-blessed-flutes',
    title: 'Alehiim Blessed — Flutes',
    duration: 185,
    source: { kind: 'storage', path: 'radio/04-alehiim-blessed-flutes.m4a' },
  },
  {
    id: 'trk-alehiim-blessed-instrumental-storybook-1',
    title: 'Alehiim Blessed — Storybook Instrumental (Alt)',
    duration: 184,
    source: {
      kind: 'storage',
      path: 'radio/05-alehiim-blessed-instrumental-storybook-1.m4a',
    },
  },
  {
    id: 'trk-alehiim-blessed-instrumental-storybook',
    title: 'Alehiim Blessed — Storybook Instrumental',
    duration: 184,
    source: { kind: 'storage', path: 'radio/06-alehiim-blessed-instrumental-storybook.m4a' },
  },
  {
    id: 'trk-alehiim-blessed-instrumental',
    title: 'Alehiim Blessed — Instrumental',
    duration: 188,
    source: { kind: 'storage', path: 'radio/07-alehiim-blessed-instrumental.m4a' },
  },
  {
    id: 'trk-alehiim-blessed-skywave-1',
    title: 'Alehiim Blessed — Skywave II',
    duration: 192,
    source: { kind: 'storage', path: 'radio/08-alehiim-blessed-skywave-1.m4a' },
  },
  {
    id: 'trk-alehiim-blessed-skywave',
    title: 'Alehiim Blessed — Skywave',
    duration: 199,
    source: { kind: 'storage', path: 'radio/09-alehiim-blessed-skywave.m4a' },
  },
  {
    id: 'trk-anthem-of-the-elm-instrumental',
    title: 'Anthem of the Elm — Instrumental',
    duration: 171,
    source: { kind: 'storage', path: 'radio/10-anthem-of-the-elm-instrumental.m4a' },
  },
  {
    id: 'trk-anthem-of-the-realm',
    title: 'Anthem of the Realm',
    duration: 176,
    source: { kind: 'storage', path: 'radio/11-anthem-of-the-realm.m4a' },
  },
  {
    id: 'trk-find-the-way-stadium-rock-anthem',
    title: 'Find the Way — Stadium Rock Anthem',
    duration: 248,
    source: { kind: 'storage', path: 'radio/12-find-the-way-stadium-rock-anthem.m4a' },
  },
  {
    id: 'trk-find-the-way',
    title: 'Find the Way',
    duration: 201,
    source: { kind: 'storage', path: 'radio/13-find-the-way.m4a' },
  },
  {
    id: 'trk-hear-us-ancient-skywave',
    title: 'Hear Us — Ancient Skywave',
    duration: 310,
    source: { kind: 'storage', path: 'radio/14-hear-us-ancient-skywave.m4a' },
  },
  {
    id: 'trk-hear-us-we-hear',
    title: 'Hear Us, We Hear',
    duration: 304,
    source: { kind: 'storage', path: 'radio/15-hear-us-we-hear.m4a' },
  },
  {
    id: 'trk-hear-us-we-hear-instrumental',
    title: 'Hear Us, We Hear — Instrumental',
    duration: 193,
    source: { kind: 'storage', path: 'radio/16-hear-us-we-hear-instrumental.m4a' },
  },
  {
    id: 'trk-march-of-nordad',
    title: 'March of Nordad',
    duration: 203,
    source: { kind: 'storage', path: 'radio/17-march-of-nordad.m4a' },
  },
  {
    id: 'trk-march-of-the-ox',
    title: 'March of the Ox',
    duration: 173,
    source: { kind: 'storage', path: 'radio/18-march-of-the-ox.m4a' },
  },
  {
    id: 'trk-medley-of-the-kingdom-2',
    title: 'Medley of the Kingdom II',
    duration: 243,
    source: { kind: 'storage', path: 'radio/19-medley-of-the-kingdom-2.m4a' },
  },
  {
    id: 'trk-medley-of-the-kingdom-3',
    title: 'Medley of the Kingdom III',
    duration: 223,
    source: { kind: 'storage', path: 'radio/20-medley-of-the-kingdom-3.m4a' },
  },
  {
    id: 'trk-people-of-the-leaves-chillstep-1',
    title: 'People of the Leaves — Chillstep II',
    duration: 166,
    source: { kind: 'storage', path: 'radio/21-people-of-the-leaves-chillstep-1.m4a' },
  },
  {
    id: 'trk-people-of-the-leaves-chillstep-2',
    title: 'People of the Leaves — Chillstep III',
    duration: 165,
    source: { kind: 'storage', path: 'radio/22-people-of-the-leaves-chillstep-2.m4a' },
  },
  {
    id: 'trk-people-of-the-leaves-chillstep',
    title: 'People of the Leaves — Chillstep',
    duration: 165,
    source: { kind: 'storage', path: 'radio/23-people-of-the-leaves-chillstep.m4a' },
  },
  {
    id: 'trk-people-of-the-leaves-pop',
    title: 'People of the Leaves — Pop',
    duration: 180,
    source: { kind: 'storage', path: 'radio/24-people-of-the-leaves-pop.m4a' },
  },
  {
    id: 'trk-people-of-the-leaves-summer-vibes',
    title: 'People of the Leaves — Summer Vibes',
    duration: 154,
    source: { kind: 'storage', path: 'radio/25-people-of-the-leaves-summer-vibes.m4a' },
  },
  {
    id: 'trk-quest-of-the-rangers',
    title: 'Quest of the Rangers',
    duration: 197,
    source: { kind: 'storage', path: 'radio/26-quest-of-the-rangers.m4a' },
  },
  {
    id: 'trk-ranger-way-instrumental',
    title: 'Ranger Way — Instrumental',
    duration: 220,
    source: { kind: 'storage', path: 'radio/27-ranger-way-instrumental.m4a' },
  },
  {
    id: 'trk-ranger-s-path-instrumental',
    title: "Ranger's Path — Instrumental",
    duration: 200,
    source: { kind: 'storage', path: 'radio/28-ranger-s-path-instrumental.m4a' },
  },
  {
    id: 'trk-rangers-skywave',
    title: 'Rangers — Skywave',
    duration: 229,
    source: { kind: 'storage', path: 'radio/29-rangers-skywave.m4a' },
  },
  {
    id: 'trk-rangers-in-the-wilderness-1',
    title: 'Rangers in the Wilderness (Alt)',
    duration: 175,
    source: { kind: 'storage', path: 'radio/30-rangers-in-the-wilderness-1.m4a' },
  },
  {
    id: 'trk-rangers-in-the-wilderness',
    title: 'Rangers in the Wilderness',
    duration: 175,
    source: { kind: 'storage', path: 'radio/31-rangers-in-the-wilderness.m4a' },
  },
  {
    id: 'trk-rangers-of-the-kingdom-celtic-folk',
    title: 'Rangers of the Kingdom — Celtic Folk',
    duration: 165,
    source: { kind: 'storage', path: 'radio/32-rangers-of-the-kingdom-celtic-folk.m4a' },
  },
  {
    id: 'trk-rangers-of-the-kingdom',
    title: 'Rangers of the Kingdom',
    duration: 170,
    source: { kind: 'storage', path: 'radio/33-rangers-of-the-kingdom.m4a' },
  },
  {
    id: 'trk-the-warden-of-the-kingdom-instrumental',
    title: 'The Warden of the Kingdom — Instrumental',
    duration: 290,
    source: { kind: 'storage', path: 'radio/34-the-warden-of-the-kingdom-instrumental.m4a' },
  },
  {
    id: 'trk-the-way-of-aldric-instrumental',
    title: 'The Way of Aldric — Instrumental',
    duration: 220,
    source: { kind: 'storage', path: 'radio/35-the-way-of-aldric-instrumental.m4a' },
  },
  {
    id: 'trk-warden-s-path-instrumental',
    title: "Warden's Path — Instrumental",
    duration: 167,
    source: { kind: 'storage', path: 'radio/36-warden-s-path-instrumental.m4a' },
  },
  {
    id: 'trk-way-of-the-ranger-instrumental',
    title: 'Way of the Ranger — Instrumental',
    duration: 213,
    source: { kind: 'storage', path: 'radio/37-way-of-the-ranger-instrumental.m4a' },
  },
  {
    id: 'trk-wisetree-final',
    title: 'Wisetree',
    duration: 278,
    source: { kind: 'storage', path: 'radio/38-wisetree-final.m4a' },
  },
  {
    id: 'trk-wisetree-instrumental-1',
    title: 'Wisetree — Instrumental II',
    duration: 202,
    source: { kind: 'storage', path: 'radio/39-wisetree-instrumental-1.m4a' },
  },
  {
    id: 'trk-wisetree-instrumental-x-rangers-of-questia-mashup',
    title: 'Wisetree × Rangers of the Kingdom — Mashup',
    duration: 290,
    source: {
      kind: 'storage',
      path: 'radio/40-wisetree-instrumental-x-rangers-of-questia-mashup.m4a',
    },
  },
  {
    id: 'trk-wisetree-instrumental',
    title: 'Wisetree — Instrumental',
    duration: 283,
    source: { kind: 'storage', path: 'radio/41-wisetree-instrumental.m4a' },
  },
  {
    id: 'trk-wisetree-sonata-instrumental-1',
    title: 'Wisetree Sonata — Instrumental (Alt)',
    duration: 253,
    source: { kind: 'storage', path: 'radio/42-wisetree-sonata-instrumental-1.m4a' },
  },
  {
    id: 'trk-wisetree-sonata-instrumental',
    title: 'Wisetree Sonata — Instrumental',
    duration: 253,
    source: { kind: 'storage', path: 'radio/43-wisetree-sonata-instrumental.m4a' },
  },
]

// The order playlists carry only songs whose own titles name that order, so a
// guest never finds somebody else's anthem on their shelf. The rest of the
// catalogue — Aldric, Wisetree, People of the Leaves, the marches and the
// medleys — sits in The Whispering Woods until the park says where it belongs.
const VALOR_TRACKS = [
  'trk-quest-of-the-rangers',
  'trk-ranger-way-instrumental',
  'trk-ranger-s-path-instrumental',
  'trk-rangers-skywave',
  'trk-rangers-in-the-wilderness',
  'trk-rangers-in-the-wilderness-1',
  'trk-rangers-of-the-kingdom',
  'trk-rangers-of-the-kingdom-celtic-folk',
  'trk-way-of-the-ranger-instrumental',
  'trk-the-warden-of-the-kingdom-instrumental',
  'trk-warden-s-path-instrumental',
  'trk-wisetree-instrumental-x-rangers-of-questia-mashup',
]

const WILDS_TRACKS = [
  'trk-alehiim-blessed-instrumental',
  'trk-alehiim-blessed-a-cappella',
  'trk-alehiim-blessed-flutes',
  'trk-alehiim-blessed-instrumental-storybook',
  'trk-alehiim-blessed-instrumental-storybook-1',
  'trk-alehiim-blessed-skywave',
  'trk-alehiim-blessed-skywave-1',
  'trk-hear-us-we-hear',
  'trk-hear-us-we-hear-instrumental',
  'trk-hear-us-ancient-skywave',
]

const LORE_TRACKS = ['trk-adventure-of-the-elm-instrumental', 'trk-anthem-of-the-elm-instrumental']

export const PLAYLISTS: RadioPlaylist[] = [
  {
    id: 'pl-woods',
    name: 'The Whispering Woods',
    blurb: 'Gather every song of the park under one canopy.',
    trackIds: TRACKS.map((t) => t.id),
  },
  {
    id: 'pl-valor',
    name: 'Songs of Valor',
    blurb: 'The Rangers of the Kingdom march to these airs.',
    orgId: 'rangers',
    art: 'assets/badge-compass-sword.png',
    trackIds: VALOR_TRACKS,
  },
  {
    id: 'pl-wilds',
    name: 'Airs of the Wilds',
    blurb: 'The Hearers of the Alehiim hold these melodies close.',
    orgId: 'alehiim',
    art: 'assets/relief-pomegranate-tree-stone.png',
    trackIds: WILDS_TRACKS,
  },
  {
    id: 'pl-lore',
    name: 'Hymns of Lore',
    blurb: 'Measures the Order of the Realm keeps sworn.',
    orgId: 'elm',
    art: 'assets/badge-crowned-realm-gold.png',
    trackIds: LORE_TRACKS,
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
