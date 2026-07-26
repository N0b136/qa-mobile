import type { AppNotification, NotificationType } from '../types'
import { load, save } from './store'
import { uid } from './ids'

const CAP = 50

function key(userId: string): string {
  return `ql:notifications:${userId}`
}

export function listFor(userId: string): AppNotification[] {
  return load<AppNotification[]>(key(userId), [])
}

export function unreadCount(userId: string): number {
  return listFor(userId).filter((n) => !n.read).length
}

export function add(
  userId: string,
  input: { type: NotificationType; title: string; body: string; icon?: string }
): AppNotification {
  const notification: AppNotification = {
    id: uid(),
    type: input.type,
    title: input.title,
    body: input.body,
    icon: input.icon,
    read: false,
    createdAt: Date.now(),
  }
  const next = [notification, ...listFor(userId)].slice(0, CAP)
  save(key(userId), next)
  void systemNotify(input.title, input.body)
  return notification
}

export function markAllRead(userId: string): void {
  save(
    key(userId),
    listFor(userId).map((n) => ({ ...n, read: true }))
  )
}

export function markRead(userId: string, id: string): void {
  save(
    key(userId),
    listFor(userId).map((n) => (n.id === id ? { ...n, read: true } : n))
  )
}

export function permissionState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestPermission(): Promise<string> {
  try {
    if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
      return 'unsupported'
    }
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export async function systemNotify(title: string, body: string): Promise<void> {
  try {
    if (permissionState() !== 'granted') return
    const reg = await navigator.serviceWorker?.ready
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
        badge: `${import.meta.env.BASE_URL}icons/icon-192.png`,
      })
      return
    }
    new Notification(title, { body })
  } catch {
    // never throw — this is a best-effort side channel
  }
}
