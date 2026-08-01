// Web push registration. The half of "chat with a Warden" that works when the
// phone is in a pocket.
//
// Everything else in this app notifies through `notificationService.systemNotify`,
// which calls `showNotification` on the live page. That only fires while a tab is
// running, which is fine for a rank-up the guest reads later and useless for a
// conversation — the whole point of the thread is that the answer reaches them
// on the trail with the screen off.
//
// ── TWO SERVICE WORKERS, TWO SCOPES ──────────────────────────────────────────
//
// The PWA already owns a worker at the root scope (VitePWA/workbox: precache,
// offline, navigation fallback). A second registration at the SAME scope
// REPLACES the first — registering Firebase's worker the documented way would
// silently take the app's offline support with it.
//
// So the push worker is registered at a NARROWED scope, `${BASE}fcm/`, which is
// always legal (you may narrow, never widen) and is what `getToken` is handed.
// Push events are delivered to the registration that owns the subscription, so
// the narrow worker gets them and the root worker is untouched. The path
// `${BASE}fcm/` never has to resolve to anything — a scope is a key, not a route.

import { FCM_VAPID_KEY, FIREBASE_CONFIG } from './firebaseConfig'
import { ensureFirebase, isConfigured } from './firebase'

export type PushState =
  /** No VAPID key pasted, or the cloud is off. Nothing to offer the user. */
  | 'unconfigured'
  /** The browser cannot do web push at all (every iOS browser before 16.4, and any non-installed iOS PWA). */
  | 'unsupported'
  /** Supported and available, not yet asked for. */
  | 'off'
  /** Registered; a token is on file. */
  | 'on'
  /** The user said no. Only they can undo this, in browser settings. */
  | 'blocked'

const TOKEN_KEY = 'ql:pushToken'

/**
 * The VAPID key is the switch for the whole feature, and it is checked SEPARATELY
 * from `isConfigured()` on purpose — see the note in firebaseConfig.
 */
export function pushConfigured(): boolean {
  return isConfigured() && !!FCM_VAPID_KEY && !FCM_VAPID_KEY.includes('PASTE_ME')
}

function swScope(): string {
  return `${import.meta.env.BASE_URL}fcm/`
}

function swUrl(): string {
  return `${import.meta.env.BASE_URL}firebase-messaging-sw.js`
}

/** Cheap, synchronous, safe to call in render. Never asks the user anything. */
export function pushState(): PushState {
  if (!pushConfigured()) return 'unconfigured'
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported'
  if (!('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission === 'granted' && localStorage.getItem(TOKEN_KEY)) return 'on'
  return 'off'
}

/**
 * Asks for permission if it has not been given, mints an FCM token and files it
 * under the signed-in account.
 *
 * Safe to call on every app start: with permission already granted it prompts
 * nobody and simply refreshes the token. That repeat call is REQUIRED, not
 * optional — the v9+ SDK dropped `onTokenRefresh`, so re-minting on load is the
 * only thing that notices a token Google has rotated out from under us. Skip it
 * and push quietly stops working for that device, with no error anywhere.
 */
export async function enablePush(
  userId: string,
  opts?: { staff?: boolean }
): Promise<PushState> {
  const state = pushState()
  if (state === 'unconfigured' || state === 'unsupported' || state === 'blocked') return state

  try {
    if (Notification.permission !== 'granted') {
      const answer = await Notification.requestPermission()
      if (answer !== 'granted') return answer === 'denied' ? 'blocked' : 'off'
    }

    const fb = await ensureFirebase()
    if (!fb) return 'off'

    const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
    if (!(await isSupported())) return 'unsupported'

    const registration = await navigator.serviceWorker.register(swUrl(), { scope: swScope() })
    // Wait for THIS registration to activate — `navigator.serviceWorker.ready`
    // would be the wrong thing entirely. It resolves with the registration whose
    // scope matches the DOCUMENT's url, which is workbox's ROOT one, already
    // active from a previous load; it resolves in the same microtask and tells
    // us nothing about the worker we just registered. And the SDK does not cover
    // for us: given an explicit `serviceWorkerRegistration` it skips its own
    // `waitForRegistrationActive` and goes straight to `pushManager.subscribe()`,
    // which throws `InvalidStateError: no active Service Worker` on a
    // registration still installing. That lands in the catch below, returns
    // 'off', and re-renders an identical "Notify me" button — the guest taps it
    // again and it works, which is exactly how a bug like this survives testing.
    await activated(registration)

    const { getApp } = await import('firebase/app')
    const token = await getToken(getMessaging(getApp()), {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration,
    })
    if (!token) return 'off'

    await fileToken(token, userId, !!opts?.staff)
    localStorage.setItem(TOKEN_KEY, token)
    return 'on'
  } catch {
    // Never throw out of here: a browser that refuses any step of this must cost
    // banners, not the screen the user is standing on.
    return 'off'
  }
}

/**
 * Hands the token back. Called on sign-out — a phone left signed in at the
 * booth must not keep buzzing with somebody else's thread.
 */
export async function disablePush(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
  if (!token) return
  try {
    const fb = await ensureFirebase()
    if (fb) {
      const { deleteDoc, doc } = await import('firebase/firestore')
      await deleteDoc(doc(fb.db, 'pushTokens', tokenDocId(token)))
    }
    const { deleteToken, getMessaging } = await import('firebase/messaging')
    const { getApp } = await import('firebase/app')
    await deleteToken(getMessaging(getApp()))
  } catch {
    // The local marker is already gone, which is what stops this device
    // claiming it is registered. A stale server row is pruned by the sender the
    // first time Google reports the token unregistered.
  }
}

/**
 * FCM tokens are long, opaque and — historically — not guaranteed free of '/',
 * which a Firestore document id may not contain. Percent-encoding is
 * deterministic (so a device re-registering overwrites its own row instead of
 * littering) and reversible (so the sender can read the token back out of the id
 * if it ever needs to).
 */
function tokenDocId(token: string): string {
  return encodeURIComponent(token)
}

/** Resolves once the given registration has an active worker (or we give up). */
function activated(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve()
  const worker = registration.installing ?? registration.waiting
  if (!worker) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      worker.removeEventListener('statechange', onChange)
      clearTimeout(timer)
      resolve()
    }
    const onChange = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') done()
    }
    // Never hang the button on this. Past the deadline we try getToken anyway —
    // it either works or falls into the same catch it would have anyway.
    const timer = setTimeout(done, 10_000)
    worker.addEventListener('statechange', onChange)
  })
}

async function fileToken(token: string, userId: string, staff: boolean): Promise<void> {
  const fb = await ensureFirebase()
  if (!fb) return
  const { doc, setDoc } = await import('firebase/firestore')
  await setDoc(
    doc(fb.db, 'pushTokens', tokenDocId(token)),
    {
      token,
      userId,
      // A CLAIM, not a credential. The sender re-checks staff/{userId} against
      // the roster before it will send a guest's words to this device — see the
      // note on `staffTokens()` in the function. It is stored only so the sender
      // can skip reading the roster for the overwhelming majority of tokens that
      // are guests.
      //
      // ── SET, NEVER CLEARED, AND THE WRITE MERGES ─────────────────────────
      //
      // The guest app and the console are two documents on ONE origin, so they
      // mint the SAME FCM token and therefore share this one row. A plain
      // setDoc from the guest side would overwrite the desk's row with
      // `staff: false`, `staffTokens()` (a `where('staff','==',true)` query)
      // would stop returning it, and the back office would go quiet — with the
      // console still rendering nothing at all, because pushState() reads
      // 'on' from the shared permission and the shared token marker.
      //
      // So the flag only ever goes up. A stale claim costs nothing: the roster
      // check downstream is what actually decides delivery.
      ...(staff ? { staff: true } : {}),
      project: FIREBASE_CONFIG.projectId,
      ua: navigator.userAgent.slice(0, 180),
      updatedAt: Date.now(),
    },
    { merge: true }
  )
}
