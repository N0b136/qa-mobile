import { useSyncExternalStore } from 'react'
import { getState, subscribe } from '../services/radioService'
import type { RadioState } from '../services/radioService'

/** Re-renders the caller whenever the radio's playback state changes. */
export function useRadio(): RadioState {
  return useSyncExternalStore(subscribe, getState)
}
