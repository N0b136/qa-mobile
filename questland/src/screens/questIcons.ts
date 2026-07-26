// Shared glyph/label helpers for the quests feature (QuestsScreen,
// QuestlineScreen, CheckInScreen). Small enough across three screens that a
// single module beats duplicating the same three maps three times.

/** org id -> Lucide glyph shown inline (list rows, mini badges). */
export const ORG_ICON: Record<string, string> = {
  rangers: 'compass',
  alehiim: 'scroll-text',
  elm: 'trees',
}

/** org id -> DS Seal brand art (the org's physical badge asset). */
export const ORG_SEAL_ART: Record<string, 'compass' | 'relief' | 'crown'> = {
  rangers: 'compass',
  alehiim: 'relief',
  elm: 'crown',
}

/** station type -> Lucide glyph. */
export const STATION_ICON: Record<string, string> = {
  puzzle: 'puzzle',
  craft: 'hammer',
  song: 'music',
  riddle: 'help-circle',
  obstacle: 'mountain',
  story: 'book-open',
  base: 'tent',
}

/** episode completion method -> ArchCard subtitle fragment. */
export const METHOD_LABEL: Record<'qr' | 'staff' | 'either', string> = {
  qr: 'Scan the marker',
  staff: "Guide's code",
  either: 'Either method',
}

/** station type -> one-line note for the MapScreen station Dialog. */
export const STATION_NOTE: Record<string, string> = {
  puzzle: 'A puzzle waits here for a sharp eye.',
  craft: 'Bring your hands — this station is a craft.',
  song: 'Voices carry further than you think at this station.',
  riddle: 'A riddle stands between you and the seal.',
  obstacle: 'This station asks for a bit of nerve.',
  story: 'A piece of the tale is told here.',
  base: 'A home station — your order keeps camp here.',
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** Roman numeral for episode numbers 1-10 (falls back to Arabic outside that range). */
export function romanNumeral(n: number): string {
  return ROMAN[n - 1] ?? String(n)
}
