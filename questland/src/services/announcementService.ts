// The notice board. Staff post notices from the Back Office console; every
// phone reads them under "Happenings" on the home screen.
//
// Same shape as the rest of the comm lanes: the local mirror (`ql:announcements`)
// is the only thing screens read, cloudSync keeps it warm off a Firestore
// snapshot, and every write here is local-first plus a fire-and-forget
// write-through. With Firebase unconfigured this is a plain local board and the
// console still works on the presenting device.

import type { Announcement } from '../types'
import { load, save } from './store'
import { uid } from './ids'
import { deleteAnnouncementDoc, pushAnnouncement } from './cloudSync'

const KEY = 'ql:announcements'

/**
 * The board is a working set, not an archive. Hero images ride in the document
 * as data URLs, so an unbounded list would eat the localStorage quota.
 */
export const BOARD_CAP = 40

/** Wide enough for a retina phone hero; past this the bytes buy nothing. */
export const HERO_MAX_WIDTH = 1400
/** Data-URL budget. Firestore's document ceiling is 1 MiB — this leaves room. */
export const HERO_MAX_CHARS = 480_000

export function listAnnouncements(): Announcement[] {
  return load<Announcement[]>(KEY, [])
}

/** Newest first, pinned notices above the rest — the console's ordering. */
export function boardOrder(list: Announcement[]): Announcement[] {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return b.publishAt - a.publishAt
  })
}

/**
 * What a guest actually sees: published, its hour come, and not yet expired.
 * A draft or a future notice is the console's business alone.
 */
export function visibleAnnouncements(now: number = Date.now()): Announcement[] {
  return boardOrder(
    listAnnouncements().filter(
      (a) =>
        a.status === 'published' &&
        a.publishAt <= now &&
        (a.expiresAt === undefined || a.expiresAt > now)
    )
  )
}

export function getAnnouncement(id: string): Announcement | undefined {
  return listAnnouncements().find((a) => a.id === id)
}

function persist(list: Announcement[]): void {
  save(KEY, boardOrder(list).slice(0, BOARD_CAP))
}

export interface AnnouncementInput {
  title: string
  blurb: string
  body: string
  eyebrow?: string
  image?: string
  imageAlt?: string
  tear?: Announcement['tear']
  status?: Announcement['status']
  publishAt?: number
  expiresAt?: number
  pinned?: boolean
  createdBy?: string
}

/** Posts a new notice. Returns the stored record. */
export function createAnnouncement(input: AnnouncementInput): Announcement {
  const now = Date.now()
  const notice: Announcement = {
    id: uid(),
    title: input.title.trim(),
    blurb: input.blurb.trim(),
    body: input.body.trim(),
    status: input.status ?? 'published',
    publishAt: input.publishAt ?? now,
    createdAt: now,
    updatedAt: now,
  }
  if (input.eyebrow?.trim()) notice.eyebrow = input.eyebrow.trim()
  if (input.image) notice.image = input.image
  if (input.imageAlt?.trim()) notice.imageAlt = input.imageAlt.trim()
  if (input.tear) notice.tear = input.tear
  if (input.expiresAt !== undefined) notice.expiresAt = input.expiresAt
  if (input.pinned) notice.pinned = true
  if (input.createdBy) notice.createdBy = input.createdBy

  persist([notice, ...listAnnouncements()])
  pushAnnouncement(notice)
  return notice
}

/**
 * Revises a notice in place. `null` strikes a field — `undefined` leaves what
 * is already there, which is what a form that never touched it means. The
 * distinction matters for exactly the two fields a revision can clear: the hero
 * and the take-down date.
 */
export function updateAnnouncement(
  id: string,
  patch: Partial<Omit<AnnouncementInput, 'image' | 'expiresAt'>> & {
    image?: string | null
    expiresAt?: number | null
  }
): Announcement | undefined {
  const existing = getAnnouncement(id)
  if (!existing) return undefined

  const next: Announcement = { ...existing, updatedAt: Date.now() }
  if (patch.title !== undefined) next.title = patch.title.trim()
  if (patch.blurb !== undefined) next.blurb = patch.blurb.trim()
  if (patch.body !== undefined) next.body = patch.body.trim()
  if (patch.eyebrow !== undefined) {
    const v = patch.eyebrow.trim()
    if (v) next.eyebrow = v
    else delete next.eyebrow
  }
  if (patch.image !== undefined) {
    if (patch.image) next.image = patch.image
    else {
      delete next.image
      delete next.imageAlt
    }
  }
  if (patch.imageAlt !== undefined) {
    const v = patch.imageAlt.trim()
    if (v) next.imageAlt = v
    else delete next.imageAlt
  }
  if (patch.tear !== undefined) next.tear = patch.tear
  if (patch.status !== undefined) next.status = patch.status
  if (patch.publishAt !== undefined) next.publishAt = patch.publishAt
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt === null) delete next.expiresAt
    else next.expiresAt = patch.expiresAt
  }
  if (patch.pinned !== undefined) {
    if (patch.pinned) next.pinned = true
    else delete next.pinned
  }

  persist(listAnnouncements().map((a) => (a.id === id ? next : a)))
  pushAnnouncement(next)
  return next
}

export function removeAnnouncement(id: string): void {
  persist(listAnnouncements().filter((a) => a.id !== id))
  deleteAnnouncementDoc(id)
}

/**
 * Seeds the board wholesale — the demo remote's entry point.
 *
 * LOCAL ONLY, and deliberately so: posting a notice is a staff power under the
 * rules, and /demo runs as the presenting GUEST, so a write-through would only
 * earn a denial. The presenter's own device is the one showing the pitch, which
 * is the only device that needs to see them.
 */
export function seedAnnouncements(list: Announcement[]): void {
  const staged = new Set(list.map((a) => a.id))
  persist([...list, ...listAnnouncements().filter((a) => !staged.has(a.id))])
}

/** Takes the staged notices back down. Local, for the same reason. */
export function clearAnnouncementsBy(prefix: string): void {
  persist(listAnnouncements().filter((a) => !a.id.startsWith(prefix)))
}

// ── Hero image ────────────────────────────────────────────────────────────────

export type HeroResult =
  | { ok: true; dataUrl: string; width: number; height: number; chars: number }
  | { ok: false; error: string }

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('unreadable'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('undecodable'))
    img.src = src
  })
}

/**
 * Takes whatever was dropped in and returns a hero small enough to live inside
 * the notice itself: downscaled to HERO_MAX_WIDTH, re-encoded, and stepped down
 * in quality until it fits the byte budget.
 *
 * Storing the picture in the document is deliberate — it means a notice needs
 * no file host and no second round trip, and it reaches a phone that is offline
 * by the same path as the words. The budget is what keeps that honest.
 */
export async function prepareHeroImage(file: File): Promise<HeroResult> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'That is not an image. Drop a jpg, png or webp.' }
  }
  let img: HTMLImageElement
  try {
    img = await loadImage(await readAsDataUrl(file))
  } catch {
    return { ok: false, error: 'That image could not be read. Try another file.' }
  }

  const scale = Math.min(1, HERO_MAX_WIDTH / (img.naturalWidth || HERO_MAX_WIDTH))
  const width = Math.max(1, Math.round((img.naturalWidth || HERO_MAX_WIDTH) * scale))
  const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ok: false, error: 'This browser cannot prepare the image.' }
  ctx.drawImage(img, 0, 0, width, height)

  // webp where the browser has an encoder, jpeg where it does not. toDataURL
  // silently hands back a png for a type it can't encode, so the prefix is
  // checked rather than assumed.
  let type = 'image/webp'
  if (!canvas.toDataURL(type, 0.8).startsWith('data:image/webp')) type = 'image/jpeg'

  for (const quality of [0.82, 0.72, 0.62, 0.5, 0.4]) {
    const dataUrl = canvas.toDataURL(type, quality)
    if (dataUrl.length <= HERO_MAX_CHARS) {
      return { ok: true, dataUrl, width, height, chars: dataUrl.length }
    }
  }
  return {
    ok: false,
    error: 'That image is too heavy even shrunk. Crop it, or use a smaller one.',
  }
}
