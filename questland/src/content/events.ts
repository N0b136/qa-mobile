import type { ParkEvent } from './types'

export const EVENTS: ParkEvent[] = [
  {
    id: 'dragons-parade',
    title: "Dragon's Night Parade",
    icon: '🐉',
    zoneId: 'forgeworks',
    daysFromNow: 2,
    time: '19:00',
    blurb:
      'Fire-breathers, acrobats, and a procession of lanterns that dance like dragons themselves. The Forge smiths lead the way.',
  },
  {
    id: 'lantern-rite',
    title: 'Lantern Rite at Lake Lumen',
    icon: '🏮',
    zoneId: 'lake',
    daysFromNow: 5,
    time: '20:30',
    blurb:
      'Hundreds of enchanted lanterns float across the still water, each one carrying a wish. The lake glows until midnight.',
  },
  {
    id: 'guild-trials',
    title: 'Guild Trials Tournament',
    icon: '🏆',
    zoneId: 'proving',
    daysFromNow: 8,
    time: '14:00',
    blurb:
      'Three guilds compete in feats of strength, wit, and courage. Even if you\'re not competing, the drama is unforgettable.',
  },
  {
    id: 'riddle-faire',
    title: 'Riddle Faire',
    icon: '🧩',
    zoneId: 'hollow',
    daysFromNow: 11,
    time: '10:00',
    blurb:
      'The market transforms into a celebration of wit. Riddlers, puzzle-makers, and clever folk gather to challenge and be challenged.',
  },
  {
    id: 'star-charting-night',
    title: 'Star-Charting Night',
    icon: '⭐',
    zoneId: 'spire',
    daysFromNow: 14,
    time: '21:00',
    blurb:
      'The Arcanum opens the observatory for all. Learn to read the stars, or simply stand beneath them and wonder.',
  },
  {
    // Canon lore — season finale from content-intake/season-1.json
    // ("finale_event"). All three orders unite as one; players pick a side
    // and move through the day as a single mass group. Summarized here
    // across its three canon phases: battle preparation, the battle itself,
    // and the victory feast.
    id: 'raid-brigands-return',
    title: "RAID: Brigand's Return",
    icon: '🔥',
    zoneId: 'proving',
    daysFromNow: 21,
    time: '10:00',
    blurb:
      "The season finale. Choose your order and stand as one: Rangers dig the line and drill for battle, Hearers set traps and train as combat medics, and the Order of the Realm sneaks off to sabotage the siege tower and rally Devorah's hidden allies. Then the brigands charge — Aldric and the Keeper hold the line until the Order and the Alehiim warriors flank in and rout Nordad's army. The day ends in a victory feast: crafts, live music, character skits, and a teaser for what comes next.",
  },
]

export function getEvent(id: string): ParkEvent | undefined {
  return EVENTS.find((e) => e.id === id)
}

export function getEventsByZone(zoneId: string): ParkEvent[] {
  return EVENTS.filter((e) => e.zoneId === zoneId).sort((a, b) => a.daysFromNow - b.daysFromNow)
}
