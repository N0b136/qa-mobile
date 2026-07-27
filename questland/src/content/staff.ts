export interface StaffPersona {
  id: string
  name: string
  role: 'warden' | 'guide'
  icon: string
  blurb: string
}

// Guild staff who answer calls for aid. Wardens hold the emergencies;
// Guides carry the hints. Names Warden Aldous and Guide Wren are canon —
// keep them exact (they already appear in sosService copy).
export const STAFF_PERSONAS: StaffPersona[] = [
  {
    id: 'warden-aldous',
    name: 'Warden Aldous',
    role: 'warden',
    icon: 'shield',
    blurb: 'Chief Warden of the Village of Queston, first to answer any call.',
  },
  {
    id: 'warden-maera',
    name: 'Warden Maera',
    role: 'warden',
    icon: 'swords',
    blurb: 'Warden of the Proving Grounds, steady in every storm and skirmish.',
  },
  {
    id: 'guide-wren',
    name: 'Guide Wren',
    role: 'guide',
    icon: 'feather',
    blurb: 'A soft-spoken Guide who keeps the Elderwood trails and offers hints.',
  },
  {
    id: 'guide-bram',
    name: 'Guide Bram',
    role: 'guide',
    icon: 'map',
    blurb: 'A wandering Guide who maps the Wilds and points lost travellers home.',
  },
]

export function getPersona(id: string): StaffPersona | undefined {
  return STAFF_PERSONAS.find((p) => p.id === id)
}

/**
 * Presents a real staff account as a persona so the console panels keep taking
 * one shape. A staff doc may name a persona above purely to borrow its glyph
 * and blurb; identity itself always comes from the account.
 */
export function personaFromStaff(staff: {
  uid: string
  name: string
  role: 'warden' | 'guide'
  personaId?: string
}): StaffPersona {
  const linked = staff.personaId ? getPersona(staff.personaId) : undefined
  return {
    id: staff.uid,
    name: staff.name,
    role: staff.role,
    icon: linked?.icon ?? (staff.role === 'warden' ? 'shield' : 'life-buoy'),
    blurb: linked?.blurb ?? '',
  }
}
