// Paste values from Firebase console > Project settings > Your apps > Web app.
// Public by design: security lives in Firestore rules, not in hiding this.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB9NfEQi6lWbatJ-dEONjos0mPTfch4ioE',
  authDomain: 'qa-mobile-36a9c.firebaseapp.com',
  projectId: 'qa-mobile-36a9c',
  storageBucket: 'qa-mobile-36a9c.firebasestorage.app',
  messagingSenderId: '448540125981',
  appId: '1:448540125981:web:320671f751aae5ff34cff4',
}

/**
 * Web Push certificate — Firebase console > Project settings > Cloud Messaging >
 * Web configuration > Web Push certificates > "Key pair". Public by design, same
 * as everything above it: it is the VAPID PUBLIC key, and a push can only be
 * sent by something holding the private half, which lives in Google's project
 * and is never in this repo.
 *
 * ── KEEP IT OUT OF FIREBASE_CONFIG ───────────────────────────────────────────
 *
 * It is deliberately a separate export rather than another field on the object
 * above. `isConfigured()` decides whether the WHOLE cloud is switched on by
 * scanning every value of FIREBASE_CONFIG for the PASTE_ME sentinel — so
 * dropping an unset key in there would take Firestore, auth, sync and the
 * console offline in one edit, to configure notifications. Push has its own
 * switch (`pushConfigured()`), and an unset key costs banners and nothing else.
 */
export const FCM_VAPID_KEY = 'PASTE_ME_VAPID_KEY'
