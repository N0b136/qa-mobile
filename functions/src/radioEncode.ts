/**
 * The encode core for Questland Radio ingest — ffmpeg and naming, nothing else.
 *
 * Deliberately free of every Firebase import. That keeps this file runnable on
 * its own (see `npm run radio:test`), which matters because the ffmpeg argument
 * strings are the part most likely to be wrong and the part a deployed function
 * proves last and most expensively.
 *
 * The settings here are the SAME ones questland/scripts/encode-songs.mjs uses.
 * They must stay that way: a song encoded to a different loudness target jumps
 * out on shuffle against the 43 that were done by hand.
 */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import * as path from 'node:path'

import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

export const BITRATE = '128k'
export const LUFS = -16

export const FFMPEG = ffmpegPath as string
export const FFPROBE = ffprobeStatic.path

export interface Measured {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      // A long encode is chatty and only the tail ever explains a failure.
      if (stderr.length > 20000) stderr = stderr.slice(-8000)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/**
 * The title is the filename as typed, minus the extension — never re-derived
 * from the slug. That round trip is exactly what turned "Aldric's Way" into
 * "Aldric S Way" when the first 43 were encoded in bulk.
 */
export function titleFrom(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim()
}

/** Object-path safe. Only ever used for the storage key, never for display. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (c: Buffer) => hash.update(c))
      .on('end', () => resolve())
      .on('error', reject)
  })
  return hash.digest('hex')
}

/** Pass one: measure the source's loudness. */
export async function measure(input: string): Promise<Measured> {
  const { code, stderr } = await run(FFMPEG, [
    '-hide_banner', '-nostats',
    '-i', input,
    '-af', `loudnorm=I=${LUFS}:TP=-1.5:LRA=11:print_format=json`,
    '-f', 'null', '-',
  ])
  if (code !== 0) throw new Error(`ffmpeg (measure) exited ${code}: ${stderr.slice(-600)}`)
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new Error(`no loudnorm measurement in ffmpeg output: ${stderr.slice(-600)}`)
  }
  return JSON.parse(stderr.slice(start, end + 1)) as Measured
}

/** Pass two: encode to the delivery format, applying the measurement. */
export async function encode(input: string, output: string, m: Measured): Promise<void> {
  const filter =
    `loudnorm=I=${LUFS}:TP=-1.5:LRA=11:` +
    `measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
    `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:` +
    `offset=${m.target_offset}:linear=true:print_format=summary`
  const { code, stderr } = await run(FFMPEG, [
    '-y', '-hide_banner', '-nostats',
    '-i', input,
    '-af', filter,
    '-map_metadata', '-1',
    '-c:a', 'aac',
    '-b:a', BITRATE,
    '-ar', '44100',
    '-ac', '2',
    '-vn',
    '-movflags', '+faststart',
    output,
  ])
  if (code !== 0) throw new Error(`ffmpeg (encode) exited ${code}: ${stderr.slice(-600)}`)
}

/** Whole seconds, read off the ENCODED file so it matches what playback reports. */
export async function probeDuration(file: string): Promise<number> {
  const { code, stdout, stderr } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ])
  if (code !== 0) throw new Error(`ffprobe exited ${code}: ${stderr.slice(-300)}`)
  return Math.round(Number(stdout.trim()) || 0)
}

// ── Routing ──────────────────────────────────────────────────────────────────
//
// Pure, and separated from the trigger on purpose: the inbox guard is the one
// piece of this pipeline whose failure mode is a runaway bill rather than a bad
// song, so it is worth being able to prove without deploying anything.

/** Mirrors FULL_SHELF_ID in questland/src/content/soundtrack.ts. */
export const FULL_SHELF = 'pl-woods'

export const INBOX = 'inbox/'
export const DONE = 'inbox/_done/'
export const OUT = 'radio/'

/** Inbox folder → playlist id. A folder outside this map is not guessed at. */
export const SHELVES: Record<string, string> = {
  valor: 'pl-valor',
  rangers: 'pl-valor',
  wilds: 'pl-wilds',
  alehiim: 'pl-wilds',
  hearers: 'pl-wilds',
  lore: 'pl-lore',
  realm: 'pl-lore',
  kingdom: FULL_SHELF,
}

export const SOURCE_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.aiff', '.aif', '.m4a', '.ogg', '.opus',
])

export type Routing =
  /** Not ours, or not usable. `quiet` marks the ones not worth logging. */
  | { take: false; reason: string; quiet: boolean }
  | {
      take: true
      fileName: string
      ext: string
      title: string
      slug: string
      trackId: string
      outPath: string
      playlistIds: string[]
      unsorted: boolean
    }

/**
 * What to do with an object that just landed in the bucket.
 *
 * The first three answers are THE LOOP GUARD. This function's caller triggers
 * on every write to a bucket it also writes to — the encoded song, the moved
 * source — so anything outside inbox/, and anything already inside _done/,
 * must be refused before a single byte is read.
 */
export function routeDrop(name: string): Routing {
  if (!name.startsWith(INBOX)) return { take: false, reason: 'outside the inbox', quiet: true }
  if (name.startsWith(DONE)) return { take: false, reason: 'already filed', quiet: true }
  // The console's "create folder" writes a zero-byte placeholder object.
  if (name.endsWith('/')) return { take: false, reason: 'folder placeholder', quiet: true }

  const rel = name.slice(INBOX.length)
  const fileName = path.basename(rel)
  const folder = rel.includes('/') ? rel.split('/')[0].toLowerCase() : ''
  const ext = path.extname(fileName).toLowerCase()

  if (!SOURCE_EXTS.has(ext)) {
    return { take: false, reason: `unsupported extension ${ext || '(none)'}`, quiet: false }
  }

  const title = titleFrom(fileName)
  const slug = slugify(title)
  if (!slug) return { take: false, reason: 'filename has no usable characters', quiet: false }

  const shelf = SHELVES[folder]
  return {
    take: true,
    fileName,
    ext,
    title,
    slug,
    trackId: `trk-${slug}`,
    outPath: `${OUT}${slug}.m4a`,
    // The full shelf always, plus the order's shelf when the folder names one.
    playlistIds: shelf && shelf !== FULL_SHELF ? [FULL_SHELF, shelf] : [FULL_SHELF],
    // Dropping into kingdom/ is a DECISION, so it is not unsorted. Only a song
    // whose folder named no shelf at all is waiting to be placed.
    unsorted: !shelf,
  }
}
