import type { SosKind, SosMessageAuthor, SosRequest, SosStatus } from '../types'
import { load, save } from './store'
import { uid } from './ids'
import { preview as chatPreview } from './sosChatService'
import { getUser } from './authService'
import { getZone } from '../content/zones'
import * as notificationService from './notificationService'
import * as cloudSync from './cloudSync'

const SOS_KEY = 'ql:sos'

function getAll(): SosRequest[] {
  return load<SosRequest[]>(SOS_KEY, [])
}

function setAll(requests: SosRequest[]): void {
  save(SOS_KEY, requests)
}

export function listSos(): SosRequest[] {
  return getAll()
}

export function listUserSos(userId: string): SosRequest[] {
  return getAll()
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function activeSosFor(userId: string, kind?: SosKind): SosRequest | null {
  const open: SosStatus[] = ['open', 'acknowledged']
  return (
    listUserSos(userId).find((r) => open.includes(r.status) && (!kind || r.kind === kind)) ?? null
  )
}

export function createSos(
  userId: string,
  kind: SosKind,
  opts?: { zoneId?: string; message?: string }
): SosRequest {
  const now = Date.now()
  const request: SosRequest = {
    id: uid(),
    userId,
    kind,
    zoneId: opts?.zoneId,
    message: opts?.message,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }
  setAll([request, ...getAll()])

  cloudSync.pushSos(request, {
    guestName: getUser(userId)?.name ?? 'A guest',
    zoneName: opts?.zoneId ? getZone(opts.zoneId)?.name : undefined,
    demo: userId.startsWith('demo-') || undefined,
  })

  // A chat gets no arrival notice. The thread opens on screen the instant this
  // returns, and a banner saying somebody is coming is precisely the promise the
  // quiet lane is not making — the answer arrives in the thread or not at all.
  if (kind === 'chat') return request

  if (kind === 'emergency') {
    notificationService.add(userId, {
      type: 'sos',
      title: 'Aid is on the way',
      body: 'Your call has reached the Wardens. Stay where you are — help is coming.',
      icon: 'shield',
    })
  } else {
    notificationService.add(userId, {
      type: 'sos',
      title: 'A Guide is coming',
      body: 'A roving Guide has your request and will reach you with a hint shortly.',
      icon: 'life-buoy',
    })
  }

  return request
}

export function acknowledgeSos(id: string, responder: string): SosRequest | null {
  const all = getAll()
  const idx = all.findIndex((r) => r.id === id)
  if (idx === -1) return null

  const now = Date.now()
  // WRITE-ONCE. This is the whole reason the field exists: `updatedAt` moves on
  // every reply and every resolve, so by the time a Manager reads the row it
  // records the LAST thing that happened to the call, not the moment a Warden
  // took it. Acknowledge is also not a one-shot gesture — the console
  // re-acknowledges on a Warden's first reply, and a second Warden may claim a
  // call already claimed — so re-stamping here would quietly reset a response
  // time that had already been earned. First claim wins.
  //
  // Write-once is enforced against THIS DEVICE'S MIRROR, which is where the
  // decision has to live: the cloud write is a plain field patch and there is
  // no server-side "set if absent". A second console that has not yet merged
  // the first one's snapshot would therefore stamp its own clock — the same
  // last-write-wins the rest of this document already lives with, and the
  // reason the card reports response time as an approximation.
  const acknowledgedAt = all[idx].acknowledgedAt ?? now
  const updated: SosRequest = {
    ...all[idx],
    status: 'acknowledged',
    responder,
    acknowledgedAt,
    updatedAt: now,
  }
  const next = [...all]
  next[idx] = updated
  setAll(next)

  cloudSync.pushSosPatch(id, {
    status: 'acknowledged',
    responder,
    acknowledgedAt,
    updatedAt: updated.updatedAt,
  })

  if (updated.kind === 'chat') {
    notificationService.add(updated.userId, {
      type: 'sos',
      title: `${responder} has your question`,
      body: 'A Warden is reading your thread now.',
      icon: 'message-circle',
    })
  } else if (updated.kind === 'emergency') {
    notificationService.add(updated.userId, {
      type: 'sos',
      title: `${responder} is on the way`,
      body: 'Hold tight — a Warden has your location and is en route.',
      icon: 'shield',
    })
  } else {
    notificationService.add(updated.userId, {
      type: 'sos',
      title: `${responder} is bringing a hint`,
      body: 'A Guide is on their way to your Station.',
      icon: 'life-buoy',
    })
  }

  return updated
}

/**
 * Records on the CALL what was last said in its thread, so the console board can
 * order and badge without a listener on every thread. Called by whichever side
 * just sent — both are allowed to write this document by the existing sos rule.
 *
 * `updatedAt` moves with it deliberately: the sos merge is last-write-wins on
 * that field, so a stamp that did not carry it would be dropped on the next
 * snapshot and the board would go back to showing nothing.
 *
 * ── THE COUNTERS TALLY LINES *SENT*, NOT LINES *DELIVERED* ──────────────────
 *
 * `sendMessage` writes the line to the mirror and returns immediately, and only
 * the server later moves it off 'pending' — so at the moment this runs nobody
 * has received anything yet, and a message that is subsequently REFUSED has
 * already been counted. Nothing walks the tally back: the counters are
 * `increment()`s on the parent, and there is no matching decrement anywhere
 * because a client that has just been refused is the last thing that should be
 * trusted to adjust a figure downward.
 *
 * The error leans the other way too, and harder. This stamp is fire-and-forget
 * (see `pushSosStamp`), so a stamp that never lands loses a line from the tally
 * while the message itself — the one write in this lane that is awaited —
 * arrives perfectly well. Under-count from a lost stamp, over-count from a
 * refused message, and no reconciliation pass between them.
 *
 * That asymmetry is deliberate: the alternative is a read-modify-write on the
 * parent per message, or a counting job over the threads the console
 * deliberately never fetches, and neither is worth buying for a management
 * chart. THE CARD IS AN INDICATOR, NOT AN AUDIT. Do not let anything downstream
 * present these figures as a record of what was said — the messages
 * subcollection is the record, and it is write-once precisely because it is.
 *
 * A call that predates this code starts counting from its NEXT line, because an
 * absent counter and Firestore's `increment(1)` agree that the first tally is
 * 1. The local arithmetic below matches that on purpose — the two sides of the
 * mirror have to reach the same number — and it is the one place `?? 0` is
 * right, since it is producing the field rather than reading it.
 *
 * `byUid` is the STAFF uid of whoever is sending, passed in by the console.
 * Absent everywhere else on purpose: the guest side has no staff identity to
 * name, and sosService must never reach into consoleService to find one — that
 * import drags the whole back office into the guest bundle.
 */
export function stampLastMessage(
  id: string,
  from: SosMessageAuthor,
  body: string,
  byUid?: string
): void {
  const at = Date.now()
  const stamp = {
    lastMessageAt: at,
    lastMessageFrom: from,
    lastMessagePreview: chatPreview(body),
  }
  const warden = from === 'warden'
  setAll(
    getAll().map((r) => {
      if (r.id !== id) return r
      const next: SosRequest = {
        ...r,
        ...stamp,
        updatedAt: at,
        messageCount: (r.messageCount ?? 0) + 1,
      }
      if (warden) {
        next.wardenReplies = (r.wardenReplies ?? 0) + 1
        if (byUid) next.replyBy = { ...r.replyBy, [byUid]: (r.replyBy?.[byUid] ?? 0) + 1 }
      }
      return next
    })
  )
  cloudSync.pushSosStamp(id, stamp, byUid)
}

export function resolveSos(id: string): void {
  const at = Date.now()
  setAll(
    getAll().map((r) =>
      r.id === id ? { ...r, status: 'resolved', resolvedAt: at, updatedAt: at } : r
    )
  )
  // `resolvedAt` is stamped rather than read back off `updatedAt` for the same
  // reason `acknowledgedAt` is: a resolved call can still be stamped again by a
  // late-arriving snapshot merge, and a closing time that drifts is worse than
  // no closing time at all.
  cloudSync.pushSosPatch(id, { status: 'resolved', resolvedAt: at, updatedAt: at })
}
