import type { LoreNote } from './types'

export const LORE_NOTES: LoreNote[] = [
  // Zone-enter notes: whispers from the park itself
  {
    id: 'zone-gatehouse',
    trigger: 'zone-enter',
    ref: 'gatehouse',
    title: 'Welcome, Wanderer',
    icon: '🏰',
    body: 'You stand at the threshold where three great orders await. Choose your path, and the realm will remember your name.',
  },
  {
    id: 'zone-hollow',
    trigger: 'zone-enter',
    ref: 'hollow',
    title: 'The Market Smiles',
    icon: '🏮',
    body: 'Footsteps echo off stone as traders call out their wares. Everyone here has come to find something—treasure, answers, or themselves.',
  },
  {
    id: 'zone-forgeworks',
    trigger: 'zone-enter',
    ref: 'forgeworks',
    title: 'The Flame Turns',
    icon: '🔥',
    body: 'Heat rises in waves as the great anvils hum beneath their steady blows. Here, metal learns to hold fire without burning.',
  },
  {
    id: 'zone-elderwood',
    trigger: 'zone-enter',
    ref: 'elderwood',
    title: 'The Forest Hears',
    icon: '🌿',
    body: 'Silence here is never empty. Every leaf listens. Every branch remembers. Walk carefully, and the forest will walk with you.',
  },
  {
    id: 'zone-lake',
    trigger: 'zone-enter',
    ref: 'lake',
    title: 'The Water Wakes',
    icon: '💧',
    body: 'Starlight mirrors on still water even though the sun hangs high. The lake exists between worlds, and it knows your secrets.',
  },
  {
    id: 'zone-spire',
    trigger: 'zone-enter',
    ref: 'spire',
    title: 'The Sky Calls',
    icon: '✨',
    body: 'Each step higher brings you closer to an answer you didn\'t know how to ask. The Arcanum waits at the top with a knowing smile.',
  },
  {
    id: 'zone-proving',
    trigger: 'zone-enter',
    ref: 'proving',
    title: 'The Ground Knows',
    icon: '🛡️',
    body: 'Sand and stone have witnessed a thousand victories and as many lessons. Today your footprints join the countless names.',
  },

  // Ambient notes: fun world flavor
  {
    id: 'ambient-owls',
    trigger: 'ambient',
    title: 'Midnight Shift',
    icon: '🦉',
    body: 'The market owls trade places with the day birds exactly at dusk—no one has ever caught them in the act, but they always know.',
  },
  {
    id: 'ambient-dragon',
    trigger: 'ambient',
    title: 'Something Stirs',
    icon: '🐉',
    body: 'Deep under the Forgeworks, the Everflame flickers once. Somewhere far below, the dragon dreams of adventures it has never lived.',
  },
  {
    id: 'ambient-mushrooms',
    trigger: 'ambient',
    title: 'Circle in the Woods',
    icon: '🍄',
    body: 'The moss-sprites rearrange the mushroom circle every full moon. It\'s definitely magic, though the Wardens refuse to explain what kind.',
  },
]

export function getLoreNote(id: string): LoreNote | undefined {
  return LORE_NOTES.find((n) => n.id === id)
}

export function getLoreNotesByTrigger(trigger: LoreNote['trigger'], ref?: string): LoreNote[] {
  return LORE_NOTES.filter((n) => n.trigger === trigger && (ref === undefined || n.ref === ref))
}
