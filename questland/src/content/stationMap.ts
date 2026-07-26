// Coordinates for the park chart (MapScreen). x/y are 0..1 fractions of
// park-map.webp's natural pixel size (0,0 = top-left) so pins track the image
// under any pan/zoom transform. Verified against the source art with
// scripts/verify-map.mjs (numbered-dot overlay, visually checked station by
// station) — see that script for the method if these ever need re-deriving.

export interface MapLandmark {
  id: string
  label: string
  blurb: string
  /** Lucide glyph name. */
  icon: string
  x: number
  y: number
}

export const MAP_META = {
  src: '/assets/park-map.webp',
  width: 2752,
  height: 1536,
}

// st-NN -> position. Matches the printed "NN. Name" markers on the map, in
// STATIONS order (content/stations.ts).
export const STATION_COORDS: Record<string, { x: number; y: number }> = {
  'st-01': { x: 0.079, y: 0.262 }, // Hidden in Plain Sight
  'st-02': { x: 0.215, y: 0.305 }, // Maker's Tent
  'st-03': { x: 0.309, y: 0.3 }, // Songcircle
  'st-04': { x: 0.235, y: 0.502 }, // Riddlebridge
  'st-05': { x: 0.115, y: 0.627 }, // Coolcreek Stone
  'st-06': { x: 0.448, y: 0.309 }, // Brigand's Hideout
  'st-07': { x: 0.575, y: 0.287 }, // Abbey Hill Ruins
  'st-08': { x: 0.389, y: 0.554 }, // Songhollow Cave
  'st-09': { x: 0.7, y: 0.842 }, // Story Willow
  'st-10': { x: 0.543, y: 0.82 }, // Southfork
  'st-11': { x: 0.279, y: 0.775 }, // Hillward Outpost
  'st-12': { x: 0.505, y: 0.555 }, // Shadetree Hollow
  'st-13': { x: 0.687, y: 0.625 }, // Path's Cross
  'st-14': { x: 0.619, y: 0.699 }, // Wonder's Hut
  // Synthetic — omitted from the generated art. Deliberate app-only pin in
  // the rocky ground SW of Silverhoard Mine. Do not try to find it on the art.
  'st-15': { x: 0.755, y: 0.6 }, // Maker's Cave
  'st-16': { x: 0.675, y: 0.535 }, // Story Oak
  'st-17': { x: 0.81, y: 0.488 }, // Silverhoard Mine
  'st-18': { x: 0.938, y: 0.547 }, // Etzhyii Village Ruins
  'st-19': { x: 0.715, y: 0.358 }, // Ranger Camp (Rangers base)
  'st-20': { x: 0.815, y: 0.712 }, // Hearer's Hollow (Hearers base)
  'st-21': { x: 0.915, y: 0.873 }, // ElmRoot (Elm base)
}

// Amenity POIs — info-only, no check-in.
export const MAP_LANDMARKS: MapLandmark[] = [
  {
    id: 'village',
    label: 'Village of Queston',
    blurb: "The gate village — provisions, the Adventurer's Hall, and the road home.",
    icon: 'castle',
    x: 0.818,
    y: 0.143,
  },
  {
    id: 'hall',
    label: "Adventurer's Hall",
    blurb: 'Passages, lost-and-found, and a Guide at the desk from nine to five.',
    icon: 'landmark',
    x: 0.939,
    y: 0.206,
  },
  {
    id: 'tavern',
    label: 'The Forest Tavern',
    blurb: 'Hot food and cold cider, open through the last quest of the day.',
    icon: 'utensils',
    x: 0.792,
    y: 0.202,
  },
  {
    id: 'parking',
    label: 'Gravel Parking Lot',
    blurb: 'Free parking for every passage. Follow the fence line back to the gate.',
    icon: 'car',
    x: 0.89,
    y: 0.345,
  },
  {
    id: 'gate',
    label: 'Entrance',
    blurb: 'Where every quest begins — and where the Wardens will find you if you call for aid.',
    icon: 'door-open',
    x: 0.781,
    y: 0.318,
  },
]

// "You are here" default — the Village of Queston.
export const DEFAULT_POSITION = { x: 0.818, y: 0.143 }
