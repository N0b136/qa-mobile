/**
 * The push sender for Calls for Aid threads.
 *
 * This is the only privileged code in the project. A web client CANNOT send a
 * push: FCM's HTTP v1 API authenticates with a service account, and the legacy
 * server key that used to make client-side sending possible is switched off for
 * good. So a message written by a phone or by the console lands in Firestore,
 * and this trigger — running as the project, under the admin SDK, which bypasses
 * the rules entirely — decides who hears about it.
 *
 * Bypassing the rules is exactly why every read below is done from the SERVER's
 * copy of a document and never from anything the sender put in the payload.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'

initializeApp()

const db = getFirestore()

/** FCM caps a multicast at 500 tokens per call. */
const FCM_BATCH = 500

/** Banners are read on a lock screen. Past this it is truncated anyway, uglier. */
const BODY_CAP = 140

interface TokenRow {
  /** Document id — the percent-encoded token. Needed to prune the row. */
  docId: string
  token: string
  userId: string
}

export const onSosMessage = onDocumentCreated(
  'sos/{sosId}/messages/{msgId}',
  async (event) => {
    const message = event.data?.data()
    if (!message) return

    const sosId = event.params.sosId
    const from = message.from === 'warden' ? 'warden' : 'guest'
    const body = String(message.body ?? '').slice(0, BODY_CAP)
    const authorName = String(message.authorName ?? '').slice(0, 60)
    if (!body) return

    // The PARENT is read from the server rather than trusting anything in the
    // message: the recipient of a warden's reply is whoever the call actually
    // belongs to, and a client that could name that in its own payload could
    // push a banner to any guest in the park.
    const parent = await db.doc(`sos/${sosId}`).get()
    if (!parent.exists) {
      logger.warn('message on a missing call', { sosId })
      return
    }
    const guestId = String(parent.get('userId') ?? '')
    if (!guestId) return

    const recipients =
      from === 'guest' ? await staffTokens() : await tokensFor(guestId)
    if (recipients.length === 0) return

    const kindLabel =
      parent.get('kind') === 'emergency'
        ? 'Emergency'
        : parent.get('kind') === 'quest-help'
          ? 'Quest help'
          : 'Question'

    const payload = {
      title:
        from === 'guest'
          ? `${authorName || 'A traveller'} — ${kindLabel}`
          : `${authorName || 'A Warden'} replied`,
      body,
      // App-RELATIVE by contract. The worker resolves it against its own scope
      // and drops anything that escapes; see firebase-messaging-sw.js.
      path: from === 'guest' ? 'console.html' : 'help',
      // One live banner per thread per device. A Warden typing four lines should
      // update one notification, not stack four.
      tag: `sos-${sosId}`,
      sosId,
    }

    await sendAll(recipients, payload)
  }
)

/**
 * Tokens belonging to one account.
 *
 * A guest may have several — phone, tablet, the spare that lives in the glovebox
 * — and all of them are legitimately theirs.
 */
async function tokensFor(userId: string): Promise<TokenRow[]> {
  const snap = await db.collection('pushTokens').where('userId', '==', userId).get()
  return snap.docs.map((d) => ({
    docId: d.id,
    token: String(d.get('token') ?? ''),
    userId,
  }))
}

/**
 * Every device on the roster.
 *
 * ── THE `staff` FIELD ON A TOKEN IS A CLAIM, NOT A CREDENTIAL ────────────────
 *
 * `pushTokens` is owner-writable, so a guest can perfectly well file a row
 * saying `staff: true`. It is used only to NARROW the scan — the roster is then
 * checked for real, per uid, against `staff/{uid}`, which no client may write.
 * A guest who lies here gets nothing but their own uid tested and rejected.
 *
 * Skipping that check would hand every guest in the park a live feed of every
 * other guest's call for aid, delivered to their lock screen.
 */
async function staffTokens(): Promise<TokenRow[]> {
  const snap = await db.collection('pushTokens').where('staff', '==', true).get()

  const rows = snap.docs.map((d) => ({
    docId: d.id,
    token: String(d.get('token') ?? ''),
    userId: String(d.get('userId') ?? ''),
  }))

  const uids = [...new Set(rows.map((r) => r.userId).filter(Boolean))]
  const verified = new Set<string>()
  await Promise.all(
    uids.map(async (uid) => {
      const doc = await db.doc(`staff/${uid}`).get()
      if (doc.exists) verified.add(uid)
    })
  )

  const rejected = rows.filter((r) => !verified.has(r.userId)).length
  if (rejected > 0) logger.warn('rejected non-roster staff token claims', { rejected })

  return rows.filter((r) => verified.has(r.userId))
}

async function sendAll(
  recipients: TokenRow[],
  data: Record<string, string>
): Promise<void> {
  const live = recipients.filter((r) => r.token)
  for (let i = 0; i < live.length; i += FCM_BATCH) {
    const batch = live.slice(i, i + FCM_BATCH)
    let result
    try {
      result = await getMessaging().sendEachForMulticast({
        tokens: batch.map((r) => r.token),
        // DATA-ONLY, deliberately. A `notification` payload is rendered by the
        // browser in the background AND handed to the page's foreground handler,
        // which is how one message becomes two banners. With data-only, exactly
        // one side renders it and the worker owns the look.
        data,
        webpush: {
          headers: {
            // Chat is worth waking the device for; a stale line is not worth
            // holding for four weeks.
            Urgency: 'high',
            TTL: '3600',
          },
        },
      })
    } catch (err) {
      logger.error('multicast failed', { err })
      continue
    }

    await pruneDead(batch, result.responses)
  }
}

/**
 * Drops rows FCM has told us are dead.
 *
 * Without this the collection only ever grows — every reinstalled app, cleared
 * browser and swapped phone leaves a token that will never be delivered to
 * again, and every message pays to try them all. Only the two codes that mean
 * "this token will never work again" prune; a transient failure keeps its row.
 */
async function pruneDead(
  batch: TokenRow[],
  responses: { success: boolean; error?: { code: string } }[]
): Promise<void> {
  const dead = batch.filter((row, i) => {
    const error = responses[i]?.error
    if (!error) return false
    return (
      error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/invalid-argument'
    )
  })
  if (dead.length === 0) return

  await Promise.all(
    dead.map((row) =>
      db
        .doc(`pushTokens/${row.docId}`)
        .delete()
        .catch((err) => logger.warn('could not prune token', { docId: row.docId, err }))
    )
  )
  logger.info('pruned dead tokens', { count: dead.length })
}
