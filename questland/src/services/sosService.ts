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

  const updated: SosRequest = { ...all[idx], status: 'acknowledged', responder, updatedAt: Date.now() }
  const next = [...all]
  next[idx] = updated
  setAll(next)

  cloudSync.pushSosPatch(id, { status: 'acknowledged', responder, updatedAt: updated.updatedAt })

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
 */
export function stampLastMessage(
  id: string,
  from: SosMessageAuthor,
  body: string
): void {
  const at = Date.now()
  const stamp = {
    lastMessageAt: at,
    lastMessageFrom: from,
    lastMessagePreview: chatPreview(body),
  }
  setAll(getAll().map((r) => (r.id === id ? { ...r, ...stamp, updatedAt: at } : r)))
  cloudSync.pushSosStamp(id, stamp)
}

export function resolveSos(id: string): void {
  const updatedAt = Date.now()
  setAll(getAll().map((r) => (r.id === id ? { ...r, status: 'resolved', updatedAt } : r)))
  cloudSync.pushSosPatch(id, { status: 'resolved', updatedAt })
}
