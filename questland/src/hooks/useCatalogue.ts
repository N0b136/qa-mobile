import { useSyncExternalStore } from 'react'
import { getTracks, subscribeCatalogue } from '../content/soundtrack'
import type { RadioTrack } from '../content/soundtrack'

/**
 * Re-renders the caller when the song catalogue changes — a new song ingested,
 * a title corrected, a song moved between shelves. The catalogue arrives from
 * Firestore after first paint, so a screen that reads it without subscribing
 * shows the bundled fallback for the life of its mount.
 */
export function useCatalogue(): RadioTrack[] {
  return useSyncExternalStore(subscribeCatalogue, getTracks, getTracks)
}
