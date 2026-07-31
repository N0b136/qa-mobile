// Manager allowlist — the read side of a SECOND hand-provisioned collection.
//
// Managers work exactly like staff: a managers/{uid} doc created BY HAND in the
// Firebase console is the whole authorisation model, and the rules refuse writes
// to that collection from every client, so there is no self-promotion path. It
// is a separate collection rather than a `role` field on the staff doc because
// nothing in firestore.rules has ever read a staff doc's fields — making one
// load-bearing would quietly change what isStaff() means everywhere.
//
// A manager MUST ALSO be staff. The console's front door is the staff gate, so a
// managers doc on its own opens nothing; the two docs are provisioned together.
//
// Honest limitation, stated plainly because it is a design boundary and not a
// bug: this is a UI gate over data staff can ALREADY read. bookings are
// staff-readable because the booth has to see a passage before it spends a Quest
// Experience against it, so the sales figures the Manager's tab totals up are
// within reach of any staff account that talks to Firestore directly. This keeps
// the day's takings off a Guide's screen. It does not make them cryptographically
// unreachable to somebody holding a staff credential.

import { ensureFirebaseWithin } from './firebase'
import { load, save } from './store'

/** Same deadline the staff lookup uses — a human is watching a spinner. */
const MANAGER_TIMEOUT_MS = 10_000

// The local mirror is for RENDERING ONLY and grants nothing: it decides whether
// the console draws the Manager's tab, never whether a read succeeds. The
// authority is the rules, which re-adjudicate every request on the server.
const MANAGER_KEY = 'ql:managerSession'

export interface ManagerDoc {
  uid: string
  name?: string
}

export type ManagerLookup =
  | { ok: true; manager: ManagerDoc }
  | { ok: false; kind: 'not-manager' }
  | { ok: false; kind: 'unavailable' }

/**
 * Reads managers/{uid}.
 *
 * The two failure kinds are the entire point of this shape and callers must keep
 * them apart. A MISSING doc is a verdict — signed in, not on the manager roll.
 * A read we could not PERFORM (cloud off, offline, timed out) is not a verdict
 * about anybody, and must never be reported to someone as "you are not a
 * manager": that turns a flat network into an accusation and sends a manager
 * looking for a Warden to fix an account that was never broken.
 */
export async function fetchManager(uid: string): Promise<ManagerLookup> {
  const fb = await ensureFirebaseWithin(MANAGER_TIMEOUT_MS)
  if (!fb) return { ok: false, kind: 'unavailable' }
  try {
    const { doc, getDoc } = await import('firebase/firestore')
    const snap = await getDoc(doc(fb.db, 'managers', uid))
    if (!snap.exists()) return { ok: false, kind: 'not-manager' }
    const data = snap.data() as Partial<ManagerDoc>
    const manager: ManagerDoc = { uid }
    // name is decoration for the tab header. A manager doc provisioned by hand
    // may well be empty, and an empty doc is still a full grant.
    const name = data.name?.trim()
    if (name) manager.name = name
    return { ok: true, manager }
  } catch {
    return { ok: false, kind: 'unavailable' }
  }
}

/** The cached mirror. Rendering only — see the note on MANAGER_KEY above. */
export function currentManager(): ManagerDoc | null {
  return load<ManagerDoc | null>(MANAGER_KEY, null)
}

/** What sign-out calls. Signed out means the tab is gone on the next paint. */
export function clearManager(): void {
  save<ManagerDoc | null>(MANAGER_KEY, null)
}

/**
 * Re-checks the cached grant against Firestore, same posture as revalidateStaff:
 * ONLY a definitive 'not-manager' clears the mirror. An unreachable roll leaves
 * the cached copy exactly where it is and hands it back, so the console stays
 * usable on its warm mirrors instead of demoting a manager every time the park's
 * connection drops.
 */
export async function revalidateManager(uid: string): Promise<ManagerDoc | null> {
  const cached = currentManager()
  const lookup = await fetchManager(uid)
  if (lookup.ok) {
    save<ManagerDoc | null>(MANAGER_KEY, lookup.manager)
    return lookup.manager
  }
  if (lookup.kind === 'not-manager') {
    clearManager()
    return null
  }
  return cached
}
