import { useSyncExternalStore } from 'react'
import { getState, subscribe } from '../services/offlineAudioService'
import type { OfflineState } from '../services/offlineAudioService'

/** Re-renders the caller whenever the offline vault changes. */
export function useOfflineAudio(): OfflineState {
  return useSyncExternalStore(subscribe, getState)
}
