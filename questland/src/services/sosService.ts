import type { SosKind, SosRequest, SosStatus } from '../types'
import { load, save } from './store'
import { uid } from './ids'
import * as notificationService from './notificationService'

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

  if (updated.kind === 'emergency') {
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

export function resolveSos(id: string): void {
  setAll(
    getAll().map((r) => (r.id === id ? { ...r, status: 'resolved', updatedAt: Date.now() } : r))
  )
}
