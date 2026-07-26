// Local-first persistence layer. Mirrors a future Firestore-backed store —
// components should never touch localStorage directly, only via load/save
// (or a domain service built on top of them).

export const KEY_PREFIX = 'ql:'

type Listener = () => void

let version = 0
const listeners = new Set<Listener>()

function notify(): void {
  version++
  listeners.forEach((fn) => fn())
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota exceeded / serialization failure — fail silently, still notify
  }
  notify()
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getVersion(): number {
  return version
}

export function clearAll(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(KEY_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
  notify()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.startsWith(KEY_PREFIX)) notify()
  })
}
