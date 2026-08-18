import type { Station, EpisodeStations } from './types'

// Canon lore — the 21 physical/thematic stations that episode station-rotations
// draw from, sourced from content-intake/season-1.json's station-type legend
// (rows 21-24 of "Season 1 Quest Lineup"). Each episode cycles through 7 of
// these 21 in canon order. Station numbering (1-21) matches the source
// spreadsheet; ids are zero-padded for stable sorting.
//
// Type legend from the source: Puzzle [p], Craft [c], Song [s], Riddle [r],
// Obstacle [o], Story [st], Base [b]. The three "Base" stations are each
// exclusive to one organization (their camp/hollow/root); all other stations
// are shared across all three questlines (orgId: null).

export const STATIONS: Station[] = [
  { id: 'st-01', name: 'Hidden in Plain Sight', type: 'puzzle', orgId: null },
  { id: 'st-02', name: "Maker's Tent", type: 'craft', orgId: null },
  { id: 'st-03', name: 'Songcircle', type: 'song', orgId: null },
  { id: 'st-04', name: 'Riddlebridge', type: 'riddle', orgId: null },
  { id: 'st-05', name: 'Coolcreek Stone', type: 'puzzle', orgId: null },
  { id: 'st-06', name: "Brigand's Hideout", type: 'obstacle', orgId: null },
  { id: 'st-07', name: 'Abbey Hill Ruins', type: 'story', orgId: null },
  { id: 'st-08', name: 'Songhollow Cave', type: 'song', orgId: null },
  { id: 'st-09', name: 'Story Willow', type: 'story', orgId: null },
  { id: 'st-10', name: 'Southfork', type: 'obstacle', orgId: null },
  { id: 'st-11', name: 'Hillward Outpost', type: 'puzzle', orgId: null },
  { id: 'st-12', name: 'Shadetree Hollow', type: 'riddle', orgId: null },
  { id: 'st-13', name: "Path's Cross", type: 'obstacle', orgId: null },
  { id: 'st-14', name: "Wonder's Hut", type: 'riddle', orgId: null },
  { id: 'st-15', name: "Maker's Cave", type: 'craft', orgId: null },
  { id: 'st-16', name: 'Story Oak', type: 'story', orgId: null },
  { id: 'st-17', name: 'Silverhoard Mine', type: 'craft', orgId: null },
  { id: 'st-18', name: 'Etzhyii Village Ruins', type: 'song', orgId: null },
  { id: 'st-19', name: 'Ranger Camp', type: 'base', orgId: 'rangers' },
  { id: 'st-20', name: "Hearer's Hollow", type: 'base', orgId: 'alehiim' },
  { id: 'st-21', name: 'Realmhold', type: 'base', orgId: 'elm' },
]

// Per-episode station rotations, in canon order, by station id.
export const EPISODE_STATIONS: EpisodeStations[] = [
  // Rangers of the Kingdom
  { episodeId: 'rg-01', stationIds: ['st-07', 'st-11', 'st-14', 'st-03', 'st-19', 'st-02', 'st-06'] },
  { episodeId: 'rg-02', stationIds: ['st-11', 'st-13', 'st-09', 'st-19', 'st-18', 'st-04', 'st-17'] },
  { episodeId: 'rg-03', stationIds: ['st-19', 'st-05', 'st-16', 'st-12', 'st-06', 'st-15', 'st-03'] },
  { episodeId: 'rg-04', stationIds: ['st-19', 'st-04', 'st-02', 'st-03', 'st-01', 'st-10', 'st-07'] },
  { episodeId: 'rg-05', stationIds: ['st-11', 'st-14', 'st-18', 'st-19', 'st-17', 'st-09', 'st-13'] },
  { episodeId: 'rg-06', stationIds: ['st-07', 'st-03', 'st-01', 'st-12', 'st-06', 'st-02', 'st-19'] },
  { episodeId: 'rg-07', stationIds: ['st-16', 'st-05', 'st-15', 'st-19', 'st-13', 'st-12', 'st-08'] },
  { episodeId: 'rg-08', stationIds: ['st-11', 'st-14', 'st-09', 'st-18', 'st-10', 'st-17', 'st-19'] },
  { episodeId: 'rg-09', stationIds: ['st-01', 'st-19', 'st-02', 'st-03', 'st-04', 'st-13', 'st-07'] },
  { episodeId: 'rg-10', stationIds: ['st-19', 'st-08', 'st-09', 'st-06', 'st-17', 'st-14', 'st-11'] },

  // Hearers of the Alehiim
  { episodeId: 'ah-01', stationIds: ['st-09', 'st-05', 'st-12', 'st-15', 'st-10', 'st-20', 'st-18'] },
  { episodeId: 'ah-02', stationIds: ['st-20', 'st-14', 'st-15', 'st-03', 'st-10', 'st-16', 'st-05'] },
  { episodeId: 'ah-03', stationIds: ['st-08', 'st-02', 'st-04', 'st-09', 'st-20', 'st-13', 'st-01'] },
  { episodeId: 'ah-04', stationIds: ['st-14', 'st-09', 'st-18', 'st-06', 'st-11', 'st-20', 'st-17'] },
  { episodeId: 'ah-05', stationIds: ['st-12', 'st-16', 'st-10', 'st-08', 'st-05', 'st-15', 'st-20'] },
  { episodeId: 'ah-06', stationIds: ['st-20', 'st-05', 'st-18', 'st-04', 'st-17', 'st-13', 'st-16'] },
  { episodeId: 'ah-07', stationIds: ['st-03', 'st-14', 'st-20', 'st-09', 'st-01', 'st-06', 'st-02'] },
  { episodeId: 'ah-08', stationIds: ['st-05', 'st-15', 'st-08', 'st-12', 'st-13', 'st-07', 'st-20'] },
  { episodeId: 'ah-09', stationIds: ['st-16', 'st-14', 'st-18', 'st-06', 'st-11', 'st-20', 'st-17'] },
  { episodeId: 'ah-10', stationIds: ['st-20', 'st-05', 'st-07', 'st-12', 'st-15', 'st-10', 'st-18'] },

  // Order of the Realm
  { episodeId: 'el-01', stationIds: ['st-04', 'st-08', 'st-17', 'st-21', 'st-16', 'st-13', 'st-01'] },
  { episodeId: 'el-02', stationIds: ['st-21', 'st-01', 'st-07', 'st-12', 'st-02', 'st-03', 'st-06'] },
  { episodeId: 'el-03', stationIds: ['st-07', 'st-11', 'st-18', 'st-17', 'st-14', 'st-10', 'st-21'] },
  { episodeId: 'el-04', stationIds: ['st-13', 'st-12', 'st-08', 'st-21', 'st-15', 'st-05', 'st-16'] },
  { episodeId: 'el-05', stationIds: ['st-07', 'st-01', 'st-03', 'st-04', 'st-02', 'st-06', 'st-21'] },
  { episodeId: 'el-06', stationIds: ['st-21', 'st-14', 'st-11', 'st-15', 'st-10', 'st-09', 'st-08'] },
  { episodeId: 'el-07', stationIds: ['st-07', 'st-04', 'st-11', 'st-10', 'st-17', 'st-18', 'st-21'] },
  { episodeId: 'el-08', stationIds: ['st-21', 'st-04', 'st-16', 'st-03', 'st-06', 'st-02', 'st-01'] },
  { episodeId: 'el-09', stationIds: ['st-05', 'st-12', 'st-08', 'st-10', 'st-15', 'st-21', 'st-09'] },
  { episodeId: 'el-10', stationIds: ['st-01', 'st-04', 'st-03', 'st-13', 'st-02', 'st-16', 'st-21'] },
]

export function getStation(id: string): Station | undefined {
  return STATIONS.find((s) => s.id === id)
}

export function stationsFor(episodeId: string): Station[] {
  const entry = EPISODE_STATIONS.find((e) => e.episodeId === episodeId)
  if (!entry) return []
  return entry.stationIds
    .map((id) => getStation(id))
    .filter((s): s is Station => Boolean(s))
}
