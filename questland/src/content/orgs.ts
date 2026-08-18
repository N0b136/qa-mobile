import type { Organization } from './types'

// Canon lore — sourced from content-intake/season-1.json (Season 1 Quest Lineup).
// Ranks are drawn from prose fragments embedded in each org's episode notes
// (no dedicated rank column exists in the source): induction happens at
// Episode 1, a mid-tier rank is named at Episode 5, and a senior rank at
// Episode 9. Episode-1 induction titles: user-approved 2026-07-25.
//
// Colors (track/color/colorSoft): USER-CONFIRMED DS track assignment, 2026-07-25.
// Rangers of the Kingdom -> Valor (ruby), Hearers of the Alehiim -> Wilds (forest/green),
// Order of the Realm -> Lore (sapphire). Replaces the earlier provisional guess.

export const ORGS: Organization[] = [
  {
    id: 'rangers',
    name: 'Rangers of the Kingdom',
    epithet: 'Trackers of the Wild Trails',
    sigil: '🏹',
    motto: 'Mark the trail. Mind the watch.',
    description:
      "Woodcraft and watchfulness, sworn at Ranger Camp. The Rangers track brigand-sign through the wild, carry warnings faster than any road, and stand the first watch when trouble comes north.",
    homeZoneId: 'st-19',
    track: 'valor',
    color: 'var(--track-valor)',
    colorSoft: 'var(--track-valor-soft)',
    ranks: [
      { name: 'Seeker', atEpisodes: 0 },
      // Induction title — user-approved 2026-07-25.
      { name: 'Ranger Recruit', atEpisodes: 1 },
      { name: 'Scout', atEpisodes: 5 },
      { name: 'Watcher', atEpisodes: 9 },
    ],
  },
  {
    id: 'alehiim',
    name: 'Hearers of the Alehiim',
    epithet: 'Listeners of the Most High',
    sigil: '🎶',
    motto: 'We hear, and we are heard.',
    description:
      'A quiet, contemplative order who find the voice of the Most High in old parables and small crafts. The Hearers mend what is broken, plant hope in season and out, and never forget what — or who — was once lost.',
    homeZoneId: 'st-20',
    track: 'wilds',
    color: 'var(--track-wilds)',
    colorSoft: 'var(--track-wilds-soft)',
    ranks: [
      { name: 'Seeker', atEpisodes: 0 },
      // Induction title — user-approved 2026-07-25.
      { name: 'Hearer', atEpisodes: 1 },
      { name: 'Tremblers', atEpisodes: 5 },
      { name: 'the Hidden', atEpisodes: 9 },
    ],
  },
  {
    id: 'elm',
    name: 'Order of the Realm',
    epithet: "Ellowyn's Sworn Company",
    sigil: '🌳',
    motto: 'Sworn in secret, faithful in the open.',
    description:
      'Founded on a single night of mischief by Princess Ellowyn and Able, the Order of the Realm keeps oaths that outgrow the games they started as. What began as a secret society is fast becoming the Kingdom\'s quiet line of defense.',
    homeZoneId: 'st-21',
    track: 'lore',
    color: 'var(--track-lore)',
    colorSoft: 'var(--track-lore-soft)',
    ranks: [
      { name: 'Seeker', atEpisodes: 0 },
      // Induction title — user-approved 2026-07-25.
      { name: 'Member of the Order', atEpisodes: 1 },
      { name: 'Sworn of the Realm', atEpisodes: 5 },
      { name: 'Guardian of the Realm', atEpisodes: 9 },
    ],
  },
]

export function getOrg(id: string): Organization | undefined {
  return ORGS.find((o) => o.id === id)
}
