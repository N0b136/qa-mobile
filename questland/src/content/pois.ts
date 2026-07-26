import type { Poi } from './types'

export const POIS: Poi[] = [
  // Gatehouse
  {
    id: 'gate-main',
    zoneId: 'gatehouse',
    name: 'Main Gate',
    kind: 'gate',
    icon: '🚪',
    x: 400,
    y: 870,
    blurb: 'The grand entrance where adventurers arrive, eyes wide, ready for whatever awaits inside.',
  },
  {
    id: 'gatehouse-quest-board',
    zoneId: 'gatehouse',
    name: "Adventurer's Quest Board",
    kind: 'quest',
    icon: '📋',
    x: 420,
    y: 850,
    blurb: 'A weathered board plastered with wanted posters, tales of glory, and desperate pleas from beyond the gates.',
  },
  {
    id: 'gatehouse-trial',
    zoneId: 'gatehouse',
    name: "Champion's First Trial",
    kind: 'quest',
    icon: '⚔️',
    x: 380,
    y: 890,
    blurb: 'Your first test begins here—nothing too fearsome, just enough to prove you belong.',
  },

  // Merchant's Hollow
  {
    id: 'hollow-quest-post',
    zoneId: 'hollow',
    name: 'Market Quest Post',
    kind: 'quest',
    icon: '🧭',
    x: 380,
    y: 650,
    blurb: 'Tucked between cloth stalls and perfume vendors, a request board hums with activity and whispered secrets.',
  },
  {
    id: 'hollow-healer',
    zoneId: 'hollow',
    name: "Healer's Tent",
    kind: 'aid',
    icon: '🏥',
    x: 410,
    y: 630,
    blurb: 'A canvas shelter where healing happens quietly—bandages, salves, and a sympathetic ear for tired adventurers.',
  },
  {
    id: 'hollow-cafe',
    zoneId: 'hollow',
    name: 'Harvest Cafe',
    kind: 'food',
    icon: '🥖',
    x: 390,
    y: 670,
    blurb: 'Warm bread, fresh fruit, and soup that tastes like someone cares deeply about how your day goes.',
  },
  {
    id: 'hollow-shop',
    zoneId: 'hollow',
    name: 'The Riddled Chest',
    kind: 'shop',
    icon: '🎁',
    x: 430,
    y: 650,
    blurb: 'A curiosity shop where ordinary items become extraordinary—if you can solve the shopkeeper\'s riddles.',
  },

  // The Forgeworks
  {
    id: 'forgeworks-trial',
    zoneId: 'forgeworks',
    name: 'Forge Workshop Trial',
    kind: 'quest',
    icon: '🔥',
    x: 620,
    y: 420,
    blurb: 'Heat from the great anvils washes over you—here is where metal sings and heroes learn to listen.',
  },
  {
    id: 'forgeworks-tavern',
    zoneId: 'forgeworks',
    name: 'Ember Tavern',
    kind: 'food',
    icon: '🍖',
    x: 640,
    y: 400,
    blurb: 'Smoke-filled and roaring with laughter, where smiths swap tales and bellies stay full.',
  },
  {
    id: 'forgeworks-rally',
    zoneId: 'forgeworks',
    name: 'Rally Point (Forge)',
    kind: 'rally',
    icon: '🚩',
    x: 600,
    y: 440,
    blurb: 'A stone platform where groups gather and strategies take shape against the glow of the Everflame.',
  },

  // The Elderwood
  {
    id: 'elderwood-trail',
    zoneId: 'elderwood',
    name: 'Warden Trail Entrance',
    kind: 'quest',
    icon: '🌿',
    x: 180,
    y: 420,
    blurb: 'Where the forest opens just enough to invite you in—moss soft under foot, air thick with pine and possibility.',
  },

  // Lake Lumen
  {
    id: 'lake-quest',
    zoneId: 'lake',
    name: 'Lake Discovery Quest',
    kind: 'quest',
    icon: '💧',
    x: 400,
    y: 300,
    blurb: 'The water calls to you with questions only found in still places and starlit nights.',
  },
  {
    id: 'lake-rally',
    zoneId: 'lake',
    name: 'Rally Point (Lake)',
    kind: 'rally',
    icon: '🚩',
    x: 380,
    y: 280,
    blurb: 'A quiet gathering place where the water\'s reflection doubles your numbers and steadies your resolve.',
  },
  {
    id: 'lake-supplies',
    zoneId: 'lake',
    name: 'Starlight Provisions',
    kind: 'shop',
    icon: '🛍️',
    x: 420,
    y: 320,
    blurb: 'Supplies gathered from near and far, arranged by merchants who understand what adventurers actually need.',
  },

  // The Astral Spire
  {
    id: 'spire-challenge',
    zoneId: 'spire',
    name: 'Arcanum Challenge',
    kind: 'quest',
    icon: '✨',
    x: 400,
    y: 110,
    blurb: 'A riddle echoes from the heights—the first step of a thousand on the path to starlight.',
  },
  {
    id: 'spire-chamber',
    zoneId: 'spire',
    name: 'Riddle Chamber',
    kind: 'quest',
    icon: '🔮',
    x: 420,
    y: 130,
    blurb: 'Behind a door you almost didn\'t see, riddles wait—each one a key to understanding deeper mysteries.',
  },

  // The Proving Grounds
  {
    id: 'proving-quest-start',
    zoneId: 'proving',
    name: 'Trial Quest Start',
    kind: 'quest',
    icon: '⚔️',
    x: 640,
    y: 700,
    blurb: 'The stone circle where champions stand and the ground itself bears witness to your courage.',
  },
  {
    id: 'proving-amphitheater',
    zoneId: 'proving',
    name: 'Grand Amphitheater',
    kind: 'show',
    icon: '🎭',
    x: 660,
    y: 680,
    blurb: 'An ancient stage where heroes are celebrated and stories become legend—tonight, yours might be told here.',
  },
]

export function getPoi(id: string): Poi | undefined {
  return POIS.find((p) => p.id === id)
}

export function getPoisInZone(zoneId: string): Poi[] {
  return POIS.filter((p) => p.zoneId === zoneId)
}
