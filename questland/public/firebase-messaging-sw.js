/*
 * The push worker. Renders a banner when a Warden or a guest says something and
 * the app is not on screen.
 *
 * ── WHY THERE IS NO FIREBASE SDK IN HERE ─────────────────────────────────────
 *
 * Firebase's documented worker starts with two `importScripts()` calls against
 * the gstatic CDN. That fetch is a live network dependency INSIDE the delivery
 * path: if it fails — captive portal at the park gate, CDN blocked, version
 * pulled — the worker throws before it has a `push` listener and the message is
 * dropped with no banner and no error anybody will ever see.
 *
 * FCM delivers over ordinary Web Push, and `onBackgroundMessage` is a wrapper
 * around the `push` event this file handles directly. The client SDK still needs
 * a registration to call `getToken()` against (that is `pushService`), but the
 * worker itself needs no SDK, no config, and no network. It also cannot drift
 * out of step with the npm `firebase` version, because it does not have one.
 *
 * ── THE PAYLOAD CONTRACT ─────────────────────────────────────────────────────
 *
 * Messages are sent DATA-ONLY (see `functions/src/index.ts`). That is not a
 * detail: a `notification` payload is rendered by the browser itself in the
 * background AND handed to the foreground `onMessage` handler, which is how you
 * get two banners for one message. Data-only means exactly one side renders,
 * every time, and this file is the only thing that decides how it looks.
 *
 * The sender and this worker must agree on these keys. Change one, change both:
 *   title, body   — what the banner reads
 *   path          — app-relative, joined onto the scope below. NEVER absolute.
 *   tag           — collapse key; one live banner per thread, not one per line
 *   sosId         — passed through to the click handler
 */

const APP_ROOT = self.registration.scope.replace(/fcm\/$/, '')
const ICON = `${APP_ROOT}icons/icon-192.png`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload = {}
  try {
    // FCM wraps data-only sends as { data: { ... } }; a raw Web Push test rig
    // sends the object bare. Accept both so this is testable without FCM.
    const parsed = event.data.json()
    payload = parsed && parsed.data ? parsed.data : parsed
  } catch {
    return
  }

  const title = payload.title || 'Questland'
  const body = payload.body || ''
  // Relative by contract. A sender that could hand us an absolute URL could
  // point a tap at any origin it liked, so the path is resolved against our own
  // scope and anything that escapes it is dropped.
  const url = safeUrl(payload.path)

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICON,
      badge: ICON,
      // One live banner per thread. Without this a ten-line answer stacks ten
      // banners on the lock screen and the guest swipes the lot away unread.
      tag: payload.tag || 'ql-sos-chat',
      renotify: true,
      data: { url, sosId: payload.sosId || '' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || APP_ROOT

  event.waitUntil(
    (async () => {
      // includeUncontrolled: the app's pages are controlled by the PWA worker at
      // the root scope, not by this one, so they are invisible without it and
      // every tap would open a second copy of the app.
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        if (client.url.startsWith(APP_ROOT) && 'focus' in client) {
          await client.focus()
          if ('navigate' in client && client.url !== target) {
            try {
              await client.navigate(target)
            } catch {
              // A cross-document navigate can be refused; a focused app is
              // still a better outcome than a second window.
            }
          }
          return
        }
      }
      await self.clients.openWindow(target)
    })()
  )
})

function safeUrl(path) {
  if (typeof path !== 'string' || !path) return APP_ROOT
  try {
    const resolved = new URL(path, APP_ROOT)
    return resolved.href.startsWith(APP_ROOT) ? resolved.href : APP_ROOT
  } catch {
    return APP_ROOT
  }
}
