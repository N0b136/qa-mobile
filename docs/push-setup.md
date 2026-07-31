# Turning on push for "Chat with a Warden"

The chat lane works today without any of this — threads sync, both sides see
every line, delivery state is honest. What is missing until these steps are done
is the **banner on a locked phone**, which is the entire reason a guest can walk
away from the screen and still get an answer.

Three things stand between here and that, and none of them can be done from this
repo alone.

---

## 1. Paste the Web Push certificate (2 minutes)

Firebase console → **Project settings → Cloud Messaging → Web configuration →
Web Push certificates → Generate key pair**. Copy the **key pair** string.

Paste it into `questland/src/services/firebaseConfig.ts`:

```ts
export const FCM_VAPID_KEY = 'PASTE_ME_VAPID_KEY'   // ← replace this
```

It is the VAPID **public** key and is public by design, exactly like the
`apiKey` above it — a push can only be sent by something holding the private
half, which lives in the Firebase project and never leaves it.

**Do not move it into `FIREBASE_CONFIG`.** `isConfigured()` decides whether the
whole cloud is switched on by scanning that object for the `PASTE_ME` sentinel,
so an unset key in there takes Firestore, auth, sync and the console offline in
one edit. Push has its own switch (`pushConfigured()`), and an unset key costs
banners and nothing else.

Until it is set, `pushState()` returns `'unconfigured'` and neither the guest's
"Notify me" nor the console's "Turn on this desk" is rendered at all. Nothing
half-offers a feature that cannot work.

## 2. Put the project on Blaze, and deploy the function

**A web client cannot send a push.** FCM's HTTP v1 API authenticates with a
service account, and the legacy server key that once made client-side sending
possible is switched off for good. So the sender has to run somewhere
privileged, and that means Cloud Functions — which means the project has to be
on the **Blaze (pay-as-you-go)** plan. Spark cannot deploy functions at all.

Cost, for honesty: at park scale this sits inside the free grant. Blaze bills
functions past 2M invocations/month; one invocation is one chat message.

```
cd functions
npm install
cd ..
npx firebase deploy --only functions
```

`functions/src/index.ts` triggers on `sos/{sosId}/messages/{msgId}` create,
reads the PARENT call from the server to find out who it belongs to, and sends
to the other side. It is the only privileged code in the project — it runs under
the admin SDK, which bypasses the Firestore rules entirely, which is why every
read in it is from the server's copy of a document and never from anything the
sender put in the payload.

## 3. Publish the rules

The chat lane needs the two new blocks in `firestore.rules`
(`sos/{id}/messages/{msgId}` and `pushTokens/{tokenId}`). Paste the **whole
file** into Firebase console → Firestore → Rules → Publish. The console REPLACES
the ruleset; a partial paste silently drops every rule it omits.

Verify first, locally, without touching the live project:

```
cd rules-tests && npm install && npm test
```

---

## Checking it actually works

Push is the one part of this feature that **cannot be verified in the sandbox**
— headless Chromium gets `ERR_CONNECTION_RESET` to Google through the agent
proxy, and a notification on a locked phone is not a thing a test harness
observes. It needs two real devices.

1. Phone, signed in as a guest, app installed to the home screen. Open
   **Call for Aid → Chat with a Warden → Start a chat**, then **Notify me** and
   accept the permission prompt.
2. Confirm a row appeared in Firestore under `pushTokens` carrying that guest's
   uid.
3. Desktop console, signed in as staff → **Calls for Aid → Turn on** (this desk
   needs its own token) → open the thread → send a line.
4. **Lock the phone.** The banner should arrive within a couple of seconds.
   Tapping it should open the app at `/help` — not a second copy of the app.
5. Reply from the phone; the console should banner too.

If step 4 is silent, in order: is the token row there; did the function run
(`npx firebase functions:log`); does the log say `pruned dead tokens` (the token
was stale — re-register); is the browser one that supports web push at all.

### iOS is the sharp edge

Safari only delivers web push to a PWA **installed to the home screen**, on
iOS 16.4+. In a Safari tab it does not work and cannot be made to. `pushState()`
reports `'unsupported'` there and the offer is not rendered — but it means an
iPhone guest who has not installed the app gets replies only while the app is
on screen. That is a real gap in the promise the chat makes, and the reason
`InstallBanner` matters more now than it did.

---

## What is deliberately not here

- **No unanswered-chat escalation.** A thread nobody answers stays open and
  climbs the board by age; nothing pages anybody. Staffing is the owner's call.
- **No typing indicators, no read receipts across devices.** Unread is derived
  per device from a local high-water mark, so it costs no writes and cannot
  contend. The sender sees delivery, not whether it was read.
- **No push on anything but chat.** Bookings, rank-ups and proclamations still
  use the in-page `systemNotify` channel. Widening that is a decision about how
  often the park is allowed to buzz somebody, not a technical step.
