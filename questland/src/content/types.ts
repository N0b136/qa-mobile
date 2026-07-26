// Content model for Questland. All lore is data — swap values freely,
// keep ids stable (progress and bookings reference them).

export interface Rank {
  name: string
  /** rank is earned when this many episodes are completed in the org */
  atEpisodes: number
}

export interface Organization {
  id: string
  name: string
  epithet: string
  sigil: string
  motto: string
  description: string
  homeZoneId: string
  /** DS questline/track this org paints as — drives ArchCard/Badge `track` prop */
  track: 'valor' | 'lore' | 'wilds' | 'forge' | 'gold'
  /** CSS color tokens */
  color: string
  colorSoft: string
  ranks: Rank[]
}

export interface Episode {
  id: string
  orgId: string
  number: number
  title: string
  tagline: string
  zoneId: string
  /** how completion is validated in the park */
  method: 'qr' | 'staff' | 'either'
  /** short code a staff member gives out (demo: shown in demo console) */
  staffCode: string
  loreOnComplete: string
  xp: number
}

export interface Zone {
  id: string
  name: string
  icon: string
  blurb: string
}

export type PoiKind = 'quest' | 'food' | 'aid' | 'shop' | 'show' | 'gate' | 'rally'

export interface Poi {
  id: string
  zoneId: string
  name: string
  kind: PoiKind
  icon: string
  /** coordinates in the 800x1000 map space */
  x: number
  y: number
  blurb: string
}

export type TicketCategory = 'day' | 'day-group' | 'membership' | 'birthday'

export interface BookingTier {
  id: string
  category: TicketCategory
  name: string
  tagline: string
  /** per-person pricing (day passes) */
  priceAdult?: number
  priceChild?: number
  /** flat price replaces per-person pricing (group bundles, memberships, birthday packages) */
  flatPrice?: number
  /** additional per-person charge once a group/family exceeds the included headcount */
  perPersonOver?: { included: number; price: number }
  /** true for recurring monthly membership products */
  monthly?: boolean
  maxParty?: number
  perks: string[]
  featured?: boolean
  icon: string
}

export interface Station {
  id: string
  name: string
  type: 'puzzle' | 'craft' | 'song' | 'riddle' | 'obstacle' | 'story' | 'base'
  /** null for stations shared across organizations; set for org-exclusive base stations */
  orgId: string | null
}

export interface EpisodeStations {
  episodeId: string
  stationIds: string[]
}

export interface AddOn {
  id: string
  name: string
  price: number
  blurb: string
  icon: string
}

export interface ParkEvent {
  id: string
  title: string
  blurb: string
  /** seeded relative to today so the demo always looks alive */
  daysFromNow: number
  time: string
  zoneId: string
  icon: string
}

export interface LoreNote {
  id: string
  /** what fires it */
  trigger: 'zone-enter' | 'episode-complete' | 'rank-up' | 'ambient'
  /** zoneId / episodeId / orgId depending on trigger */
  ref?: string
  title: string
  body: string
  icon: string
}
