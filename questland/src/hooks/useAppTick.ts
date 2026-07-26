import { useSyncExternalStore } from 'react'
import { subscribe, getVersion } from '../services/store'

/** Re-renders the caller whenever the local store changes (any key). */
export function useAppTick(): number {
  return useSyncExternalStore(subscribe, getVersion)
}
