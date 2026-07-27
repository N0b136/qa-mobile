// Session-only flag for the gate-opening intro (GateIntro.tsx). Uses
// sessionStorage directly (not the localStorage-backed store.ts) since the
// intro should replay on every new session/tab, never persist across them.

const SEEN_KEY = 'ql:gate-seen'

export function hasSeenGate(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markGateSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    // storage unavailable (private mode / quota) — intro may replay, harmless
  }
}
