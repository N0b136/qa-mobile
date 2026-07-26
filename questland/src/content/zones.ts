// Zones are derived from the canon stations in stations.ts plus the Village of
// Queston hub, replacing the earlier placeholder geography (Gatehouse Plaza,
// Merchant's Hollow, etc.). `icon` values are Lucide glyph names, not emoji.

import type { Station, Zone } from './types'
import { STATIONS } from './stations'

const TYPE_GLYPH: Record<Station['type'], string> = {
  puzzle: 'puzzle',
  craft: 'hammer',
  song: 'music',
  riddle: 'help-circle',
  obstacle: 'mountain',
  story: 'book-open',
  base: 'tent',
}

const BASE_BLURB: Record<string, string> = {
  rangers: "The Rangers' home camp.",
  alehiim: "The Hearers' hollow.",
  elm: 'The root-hall of the Elm.',
}

const TYPE_BLURB: Record<Station['type'], string> = {
  puzzle: 'A puzzle station along the questlines.',
  craft: 'A craft station along the questlines.',
  song: 'A song station along the questlines.',
  riddle: 'A riddle station along the questlines.',
  obstacle: 'An obstacle station along the questlines.',
  story: 'A story station along the questlines.',
  base: 'An organization base station.',
}

function blurbFor(station: Station): string {
  if (station.type === 'base' && station.orgId) {
    return BASE_BLURB[station.orgId] ?? TYPE_BLURB.base
  }
  return TYPE_BLURB[station.type]
}

export const ZONES: Zone[] = [
  {
    id: 'village',
    name: 'Village of Queston',
    icon: 'castle',
    blurb: 'The heart of Queston, where every quest begins and the Wardens keep watch.',
  },
  ...STATIONS.map(
    (station): Zone => ({
      id: station.id,
      name: station.name,
      icon: TYPE_GLYPH[station.type],
      blurb: blurbFor(station),
    })
  ),
]

export function getZone(id: string): Zone | undefined {
  return ZONES.find((z) => z.id === id)
}
