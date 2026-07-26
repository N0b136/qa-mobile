import type { NotificationType } from '../types'

export interface ConsoleTemplate {
  id: string
  type: NotificationType
  icon: string
  label: string
  title: string
  body: string
}

// Presenter's remote: the console shows `label` as a chip; firing sends
// `title`/`body` to guests. Emoji-free — icons are Lucide glyph names.
export const CONSOLE_TEMPLATES: ConsoleTemplate[] = [
  {
    id: 'tpl-lantern-rite',
    type: 'event',
    icon: 'sparkles',
    label: 'Lantern Rite',
    title: 'Lantern Rite tonight',
    body: 'Gather at dusk at Lake Lumen for the floating of the lanterns.',
  },
  {
    id: 'tpl-visit-tomorrow',
    type: 'booking',
    icon: 'ticket',
    label: 'Visit reminder',
    title: 'Your visit is tomorrow',
    body: 'Arrive by your chosen hour; the gates open at nine.',
  },
  {
    id: 'tpl-elderwood-whisper',
    type: 'lore',
    icon: 'scroll-text',
    label: 'Elderwood whisper',
    title: 'A whisper from the Elderwood',
    body: 'The oldest tree stirs — a new chapter opens to those who listen.',
  },
  {
    id: 'tpl-party-joined',
    type: 'system',
    icon: 'users',
    label: 'Party joined',
    title: 'A traveller joined your party',
    body: 'Sable now travels with the Ashen Vanguard.',
  },
  {
    id: 'tpl-warden-broadcast',
    type: 'sos',
    icon: 'shield',
    label: 'SOS broadcast',
    title: 'Warden broadcast',
    body: 'All Wardens to the Proving Grounds — a hero needs aid.',
  },
  {
    id: 'tpl-weather-advisory',
    type: 'system',
    icon: 'cloud-rain',
    label: 'Weather advisory',
    title: 'Rain rolls over the Wilds',
    body: 'Showers reach Queston within the hour — the Forest Tavern keeps a dry hearth.',
  },
  {
    id: 'tpl-last-call',
    type: 'system',
    icon: 'clock',
    label: 'Last call',
    title: 'One hour until the gates close',
    body: 'Finish your final station and gather at the Village of Queston; the gates lock at nine.',
  },
  {
    id: 'tpl-brigands-return',
    type: 'event',
    icon: 'swords',
    label: 'RAID rally',
    title: "RAID: Brigand's Return",
    body: 'All three orders to the Village of Queston — the brigands ride at dusk. Stand together.',
  },
]
