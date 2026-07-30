#!/usr/bin/env node
// provision-key.mjs — write the per-park PSK into a board's NVS at bench assembly.
//
//   node firmware/tools/provision-key.mjs --new ~/questland-park.key
//   node firmware/tools/provision-key.mjs --port /dev/ttyUSB0 --key-file ~/questland-park.key
//   node firmware/tools/provision-key.mjs --port /dev/ttyUSB0 --key-file ~/... --inspect
//   node firmware/tools/provision-key.mjs --fingerprint ~/questland-park.key
//
// ── THE KEY IS NEVER IN THIS REPOSITORY ─────────────────────────────────────
//
// This tool SHIPS, the key does NOT. It mints 16 bytes from the OS CSPRNG,
// writes them to a file OUTSIDE the working tree with mode 0600, and refuses —
// hard, with no override — to put key material anywhere under the repository
// root or to print the bytes to a terminal. There is no default key, no example
// key, no test key. The known-answer vectors in PROTOCOL.md use an obviously
// fake counting pattern (00 01 02 ... 0F) and say so in the document.
//
// If you need to check that two boards hold the same key, compare FINGERPRINTS.
// The fingerprint is HMAC-SHA256(psk, "QL1-fpr")[0..3] — the same derivation
// ql_crypto.h prints on the hub's boot banner and on the station's service
// channel — so it can be read aloud across a workshop and reveals nothing about
// the key. The bench procedure is literally "all twenty-two boards show the same
// eight characters".
//
// ── WHY IT REFUSES A BOARD THAT ALREADY HOLDS A KEY ─────────────────────────
//
// Writing NVS here means flashing a WHOLE NVS PARTITION IMAGE. There is no
// supported way to poke one key into a live partition from outside, so the write
// ERASES EVERYTHING ELSE IN NVS on that board:
//
//   * the seq counter, with its 64-ahead reservation window. That window is
//     what makes the hub's replay high-water mark sound (correction #7); wiping
//     it restarts seq near zero, and the hub then DROPS EVERY FRAME from that
//     station as a replay until it climbs back past the old mark. On a station
//     that had been running a week, that is the whole park's worth of taps from
//     one plinth, silently discarded, with the station reporting perfect health.
//     The board recovers only because EPOCH is in the nonce and the hub's mark
//     is re-anchored on a fresh lineage — which is exactly the case ql_crypto.h
//     put EPOCH there for. It still costs you every queued tap.
//   * the cached flag table, so the station is deaf until the next beacon and
//     chunk cycle completes.
//   * THE TAP QUEUE. Those are guest check-ins that were waiting for a console
//     tab to open. They are gone, and nothing anywhere will say so.
//
// On a fresh board off the bench all of that is empty and the write costs
// nothing. On a board that has been in the woods it is a real loss, which is why
// --force exists and why it makes you say it twice.
//
// ── WHAT THIS TOOL NEEDS ────────────────────────────────────────────────────
//
//   esptool            (esptool.py / esptool / python -m esptool)
//   nvs_partition_gen  ESP-IDF's NVS image generator. Found automatically at
//                      $IDF_PATH/components/nvs_flash/nvs_partition_generator/,
//                      or point at it with --nvs-gen <path>.
//
// Neither is vendored here: they are Espressif's, they move with the IDF, and a
// copy in this repository would be a copy that rots.

import { spawnSync } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIRMWARE = resolve(HERE, '..')
const ROOT = resolve(FIRMWARE, '..')

const PSK_LEN = 16
const NVS_NAMESPACE = 'questland'
const NVS_KEY = 'psk'
const PARTITION_TABLE_OFFSET = 0x8000
const PARTITION_TABLE_SIZE = 0xc00

// ── argv ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
function flag(name) {
  return argv.includes(name)
}
function opt(name, fallback = null) {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}

if (flag('--help') || flag('-h') || argv.length === 0) {
  usage()
  process.exit(0)
}

function usage() {
  process.stdout.write(`
provision-key.mjs — write the per-park PSK to a board's NVS.

  --new <path>            Mint a NEW park key (16 bytes, node:crypto CSPRNG) and
                          save it to <path>, mode 0600. Does this ONCE per park.
                          Refuses to overwrite, and refuses any path inside the
                          repository.

  --fingerprint <path>    Print a key file's fingerprint and exit. Touches no
                          board. This is the value the hub prints at boot and
                          the station prints on its service channel.

  --port <device>         Serial port of the board to provision.
  --key-file <path>       The park key minted by --new.
  --chip <name>           Default esp32.
  --baud <rate>           Default 460800.
  --nvs-gen <path>        ESP-IDF nvs_partition_gen.py, if it is not on IDF_PATH.
  --inspect               Report what the board already holds and stop. Writes
                          nothing. Safe on a live plinth.
  --dry-run               Do everything except the final write_flash.
  --force                 Provision a board that ALREADY holds a key. Erases the
                          rest of its NVS — read the comment at the top of this
                          file before using it.
  --i-will-lose-the-queue Required alongside --force. Two words, deliberately.

Bench procedure:
  1. once per park:   --new ~/questland-park.key           (keep it off the repo)
  2. once per board:  --port ... --key-file ~/questland-park.key
  3. power each board and confirm all twenty-two print the SAME fingerprint.
`)
}

/**
 * Refusals THROW rather than calling process.exit.
 *
 * That is not style. process.exit() terminates immediately and DOES NOT RUN
 * PENDING `finally` BLOCKS, so an exit from inside the provisioning flow would
 * leave the temp directory — which at that moment holds the park PSK in a CSV
 * and in a partition image — sitting on disk under /tmp with nothing scheduled
 * to shred it. Throwing lets the one cleanup path at the bottom of this file
 * always run, on every exit route including the successful one.
 */
class Abort extends Error {
  constructor(msg, hint) {
    super(msg)
    this.name = 'Abort'
    this.hint = hint
  }
}

function die(msg, hint) {
  throw new Abort(msg, hint)
}

// ── key material ────────────────────────────────────────────────────────────

/**
 * The same derivation ql_crypto.h uses, so the string this prints is the string
 * the board prints:
 *
 *     fpr = HMAC-SHA256(PSK, "QL1-fpr")[0..3], uppercase hex
 *
 * The PSK is the HMAC KEY and the label is the MESSAGE. Get that the wrong way
 * round here and every board agrees with every other board and disagrees with
 * the firmware — which is the most confusing possible failure, because the
 * workshop check ("all twenty-two show the same eight characters") passes.
 *
 * It is a one-way derivation on purpose: the fingerprint can be read aloud, put
 * on a label, or pasted into a chat, and it reveals nothing about the key.
 */
function keyFingerprint(psk) {
  return createHmac('sha256', psk).update('QL1-fpr', 'ascii').digest().subarray(0, 4).toString('hex').toUpperCase()
}

/** True if `path` is inside the repository. Key material must never be. */
function insideRepo(path) {
  const p = resolve(path)
  return p === ROOT || p.startsWith(ROOT + sep)
}

function readKeyFile(path) {
  if (!existsSync(path)) die(`no key file at ${path}`, 'Mint one with --new, or point --key-file at the park key.')
  const raw = readFileSync(path)
  // Accept either 16 raw bytes or 32 hex characters with optional whitespace.
  const text = raw.toString('utf8').trim()
  let psk
  if (/^[0-9a-fA-F]{32}$/.test(text)) psk = Buffer.from(text, 'hex')
  else if (raw.length === PSK_LEN) psk = Buffer.from(raw)
  else die(`${path} is not a park key`, `Expected ${PSK_LEN} raw bytes or ${PSK_LEN * 2} hex characters.`)

  // An all-zero or all-same key is what a failed random source looks like, and
  // it would sail through every other check in this file.
  if (psk.every((b) => b === psk[0])) {
    die('that key file is a single repeated byte', 'That is what a broken random source produces. Mint a fresh key.')
  }
  try {
    const mode = statSync(path).mode & 0o777
    if (mode & 0o077) {
      process.stderr.write(
        `provision-key: warning — ${path} is mode ${mode.toString(8)}; the park key should be 0600.\n`,
      )
    }
  } catch {
    /* mode is advisory */
  }
  return psk
}

// ── --new ───────────────────────────────────────────────────────────────────

function mintNewKey() {
  const path = opt('--new')
  if (insideRepo(path)) {
    die(
      `refusing to write key material to ${path}`,
      'That path is inside the repository. The PSK is the only secret in this system and a\n' +
        'committed key is a park anyone can drive. Put it in a password manager or on the\n' +
        "workshop's encrypted volume, outside the working tree. There is no override for this.",
    )
  }
  if (existsSync(path)) {
    die(
      `${path} already exists`,
      'Refusing to overwrite a park key. If you genuinely want a NEW park key, understand that\n' +
        'every board already provisioned becomes deaf the moment one board holds the new one:\n' +
        'a MAC failure is indistinguishable from a dead radio from the counter. Re-key the whole\n' +
        'park in one session or not at all. Move the old file aside yourself.',
    )
  }

  // randomBytes, not Math.random, not a hash of the time, not a uuid. This is
  // the OS CSPRNG and it is the only acceptable source for the one secret in
  // the system.
  const psk = randomBytes(PSK_LEN)
  writeFileSync(path, psk.toString('hex') + '\n', { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best effort on filesystems without modes */
  }
  process.stdout.write(`\nMinted a park key: ${path}  (mode 0600)\n`)
  process.stdout.write(`Fingerprint: ${keyFingerprint(psk)}\n\n`)
  process.stdout.write('Back it up NOW, somewhere that is not this machine and not this repository.\n')
  process.stdout.write('There is no recovery: lose it and every board in the park must be re-provisioned\n')
  process.stdout.write('by hand, with a cable, one at a time.\n\n')
}

// ── tool discovery ──────────────────────────────────────────────────────────

function tryRun(cmd, args, input) {
  return spawnSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
}

function findEsptool() {
  const candidates = [
    ['esptool.py', []],
    ['esptool', []],
    ['python3', ['-m', 'esptool']],
    ['python', ['-m', 'esptool']],
  ]
  for (const [cmd, pre] of candidates) {
    const r = tryRun(cmd, [...pre, 'version'])
    if (r.status === 0) return { cmd, pre }
  }
  die(
    'esptool not found',
    'Install it with:  pip install esptool\n' +
      'or use the copy inside your Arduino ESP32 core / ESP-IDF and put it on PATH.',
  )
}

function findNvsGen() {
  const explicit = opt('--nvs-gen')
  if (explicit) {
    if (!existsSync(explicit)) die(`--nvs-gen ${explicit} does not exist`)
    return explicit
  }
  const idf = process.env.IDF_PATH
  if (idf) {
    const p = join(idf, 'components', 'nvs_flash', 'nvs_partition_generator', 'nvs_partition_gen.py')
    if (existsSync(p)) return p
  }
  die(
    'nvs_partition_gen.py not found',
    'It ships with ESP-IDF at\n' +
      '  $IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py\n' +
      'Set IDF_PATH, or pass --nvs-gen <path>. It is deliberately not vendored into this\n' +
      'repository: it belongs to Espressif and it moves with the IDF.',
  )
}

// ── the board ───────────────────────────────────────────────────────────────

function esptool(esp, port, chip, baud, args) {
  const full = [...esp.pre, '--chip', chip, '--port', port, '--baud', String(baud), ...args]
  const r = tryRun(esp.cmd, full)
  if (r.status !== 0) {
    die(
      `esptool failed: ${esp.cmd} ${full.join(' ')}`,
      (r.stderr || r.stdout || '').trim() +
        '\n\nIf it cannot enter the bootloader, hold BOOT while it says "Connecting".',
    )
  }
  return r
}

/**
 * The board's partition table, read off the chip rather than guessed from a
 * project file. A DevKitC flashed with the Huge APP scheme does not put NVS
 * where the default scheme does, and writing a partition image at the wrong
 * offset overwrites the application.
 */
function readPartitions(esp, port, chip, baud, tmp) {
  const bin = join(tmp, 'ptable.bin')
  esptool(esp, port, chip, baud, [
    'read_flash',
    `0x${PARTITION_TABLE_OFFSET.toString(16)}`,
    `0x${PARTITION_TABLE_SIZE.toString(16)}`,
    bin,
  ])
  const buf = readFileSync(bin)
  const out = []
  for (let off = 0; off + 32 <= buf.length; off += 32) {
    if (buf.readUInt16LE(off) !== 0x50aa) break
    out.push({
      type: buf[off + 2],
      subtype: buf[off + 3],
      offset: buf.readUInt32LE(off + 4),
      size: buf.readUInt32LE(off + 8),
      label: buf.subarray(off + 12, off + 28).toString('ascii').replace(/\0.*$/, ''),
    })
  }
  if (out.length === 0) die('could not read a partition table from the board', 'Is it in bootloader mode?')
  const nvs = out.find((p) => p.type === 0x01 && p.subtype === 0x02) ?? out.find((p) => p.label === 'nvs')
  if (!nvs) {
    die(
      'this board has no NVS partition',
      'Partitions found: ' + out.map((p) => `${p.label}(${p.type}/${p.subtype})`).join(', ') +
        '\nFlash the sketch first — the partition table comes from the build, not from this tool.',
    )
  }
  return { all: out, nvs }
}

/**
 * Walk an NVS partition image and report what is in it.
 *
 * A real page walk rather than a byte scan for the string "psk": a scan would
 * match an erased entry, a stale copy left behind by NVS's copy-on-write
 * compaction, or the four bytes appearing inside somebody's blob. This
 * distinguishes WRITTEN entries from erased and empty ones, which is the whole
 * question --force turns on.
 *
 * On anything it does not understand it returns `certain: false`, and the caller
 * then REFUSES rather than proceeding — an unreadable partition is the one case
 * where guessing costs a station's tap queue.
 */
function inspectNvs(buf) {
  const PAGE = 4096
  const ENTRY = 32
  const ENTRIES_PER_PAGE = 126
  const HEADER = 32
  const BITMAP = 32

  const namespaces = new Map() // index -> name
  const items = [] // { ns, key, type, span, at }
  let certain = true

  for (let base = 0; base + PAGE <= buf.length; base += PAGE) {
    const state = buf.readUInt32LE(base)
    // 0xFFFFFFFF uninitialised, 0xFFFFFFFE active, 0xFFFFFFFC full,
    // 0xFFFFFFF8 freeing, 0xFFFFFFF0 corrupt. Anything else is not NVS.
    if (state === 0xffffffff) continue
    if (![0xfffffffe, 0xfffffffc, 0xfffffff8, 0xfffffff0].includes(state >>> 0)) {
      certain = false
      continue
    }
    const bitmap = buf.subarray(base + HEADER, base + HEADER + BITMAP)
    for (let i = 0; i < ENTRIES_PER_PAGE; i++) {
      const st = (bitmap[i >> 2] >> ((i & 3) * 2)) & 0x3
      if (st !== 0x2) continue // 3 = empty, 0 = erased, 2 = written
      const at = base + HEADER + BITMAP + i * ENTRY
      const ns = buf[at]
      const type = buf[at + 1]
      const span = buf[at + 2]
      const key = buf.subarray(at + 8, at + 24).toString('ascii').replace(/\0.*$/, '')
      if (!/^[\x20-\x7E]{1,15}$/.test(key)) continue
      if (ns === 0) namespaces.set(buf[at + 24], key) // namespace registry entry
      else items.push({ ns, key, type, span, at })
    }
  }

  return { namespaces, items, certain }
}

// NVS item types, from the IDF's nvs_types.hpp. Only the blob family matters
// here; the rest are listed so a reader can see what was excluded and why.
const NVS_TYPE_BLOB = 0x41 // legacy single-entry blob
const NVS_TYPE_BLOB_DATA = 0x42 // a blob chunk: header entry, then the payload
const NVS_TYPE_BLOB_IDX = 0x48 // the INDEX for a chunked blob — no payload in it

/**
 * The 16-byte blob payload for a written variable-length entry, or null.
 *
 * The payload begins in the entry AFTER the header, which is why `span` must be
 * at least 2. A BLOB_IDX entry carries the SAME KEY as its data chunks and has
 * span 1 with no payload at all, so a naive "first entry whose key is psk" picks
 * the index roughly half the time and reports a correctly provisioned board as
 * unverifiable. That is not a cosmetic bug: the read-back check below treats an
 * unreadable payload as a failed write, so it would condemn good boards at the
 * bench.
 */
function blobPayload(buf, item) {
  if (item.type === NVS_TYPE_BLOB_IDX) return null
  if (item.type !== NVS_TYPE_BLOB && item.type !== NVS_TYPE_BLOB_DATA) return null
  if (item.span < 2) return null
  const size = buf.readUInt16LE(item.at + 24)
  if (size !== PSK_LEN) return null
  const start = item.at + 32
  if (start + size > buf.length) return null
  return buf.subarray(start, start + size)
}

/**
 * The PSK entry and its bytes, or `{ item, payload: null }` if the key is
 * present but its payload cannot be read, or null if there is no PSK at all.
 * Searches every matching entry rather than taking the first, for the BLOB_IDX
 * reason above.
 */
function findPsk(state, buf) {
  const candidates = state.items.filter((it) => it.key === NVS_KEY)
  if (candidates.length === 0) return null
  for (const item of candidates) {
    const payload = blobPayload(buf, item)
    if (payload) return { item, payload }
  }
  return { item: candidates[0], payload: null }
}

// ── provision ───────────────────────────────────────────────────────────────

/** Set once the temp directory exists, so the shredder at the bottom can find it. */
let tmp = null

function provisionBoard() {
  const port = opt('--port')
  const inspectOnly = flag('--inspect')
  const dryRun = flag('--dry-run')
  const force = flag('--force')
  const chip = opt('--chip', 'esp32')
  const baud = opt('--baud', '460800')

  if (!port) die('no --port given', 'Example: --port /dev/ttyUSB0   (Windows: --port COM7)')

  const keyPath = opt('--key-file')
  if (!keyPath && !inspectOnly) {
    die('no --key-file given', 'Mint the park key once with --new, then point every board at that file.')
  }
  const psk = keyPath ? readKeyFile(keyPath) : null
  const wantFpr = psk ? keyFingerprint(psk) : null

  const esp = findEsptool()
  tmp = mkdtempSync(join(tmpdir(), 'ql-provision-'))
  try {
    chmodSync(tmp, 0o700)
  } catch {
    /* best effort */
  }

  const { nvs } = readPartitions(esp, port, chip, baud, tmp)
  process.stdout.write(`\nBoard on ${port}: NVS at 0x${nvs.offset.toString(16)}, ${nvs.size} bytes.\n`)

  const dumpPath = join(tmp, 'nvs-before.bin')
  esptool(esp, port, chip, baud, ['read_flash', `0x${nvs.offset.toString(16)}`, `0x${nvs.size.toString(16)}`, dumpPath])
  const before = readFileSync(dumpPath)
  const state = inspectNvs(before)

  const existing = findPsk(state, before)
  const nsName = existing ? state.namespaces.get(existing.item.ns) ?? `<index ${existing.item.ns}>` : null

  if (!state.certain) {
    die(
      "this board's NVS partition is not in a layout this tool understands",
      'Refusing to touch it. Guessing here costs whatever else is in NVS — including any queued\n' +
        'taps, which are guest check-ins nobody will ever know were lost. Erase the board with\n' +
        '`esptool.py erase_flash`, reflash the sketch, and provision it as a fresh board.',
    )
  }

  if (existing) {
    const fpr = existing.payload ? keyFingerprint(existing.payload) : null
    process.stdout.write(`  ALREADY PROVISIONED: "${NVS_KEY}" in namespace "${nsName}"`)
    process.stdout.write(fpr ? `, fingerprint ${fpr}\n` : ' (fingerprint unreadable from the dump)\n')
    if (fpr && wantFpr) {
      process.stdout.write(
        fpr === wantFpr
          ? '  It already holds THIS park key. Nothing to do.\n'
          : `  It holds a DIFFERENT key (this file is ${wantFpr}).\n`,
      )
    }
  } else {
    process.stdout.write('  No PSK in NVS — this board is unprovisioned and its radio is disabled.\n')
  }
  const others = state.items.filter((it) => it.key !== NVS_KEY).length
  process.stdout.write(`  ${others} other NVS ${others === 1 ? 'entry' : 'entries'} present.\n`)

  if (inspectOnly) {
    process.stdout.write('\n--inspect: nothing written.\n\n')
    return
  }

  if (existing) {
    if (existing.payload && wantFpr && keyFingerprint(existing.payload) === wantFpr && !force) {
      process.stdout.write('\nThis board already holds this exact park key. Nothing written.\n\n')
      return
    }
    if (!force) {
      die(
        'this board already holds a PSK',
        'Refusing to overwrite it. Writing NVS means flashing a whole partition image, so it also\n' +
          `erases the ${others} other entries above — the seq counter (which is what makes the hub's\n` +
          'replay high-water mark sound), the cached flag table, and THE TAP QUEUE, which is guest\n' +
          'check-ins waiting for a console tab.\n\n' +
          'If you mean it: --force --i-will-lose-the-queue',
      )
    }
    if (!flag('--i-will-lose-the-queue')) {
      die('--force needs --i-will-lose-the-queue alongside it', 'Two words, on purpose. Read the paragraph above.')
    }
  }

  // ── build the NVS image ───────────────────────────────────────────────────
  //
  // The CSV and the image are written into a 0700 temp directory OUTSIDE the
  // repository, and both are overwritten with zeros before being unlinked. An
  // unlink alone leaves the key recoverable from free blocks; on an SSD even the
  // overwrite is not a guarantee, which is one more reason the key belongs in a
  // password manager and this file's life is measured in seconds.
  const csvPath = join(tmp, 'psk.csv')
  const binPath = join(tmp, 'psk-nvs.bin')
  const csv =
    'key,type,encoding,value\n' +
    `${NVS_NAMESPACE},namespace,,\n` +
    `${NVS_KEY},data,hex2bin,${psk.toString('hex')}\n`
  writeFileSync(csvPath, csv, { mode: 0o600 })

  const nvsGen = findNvsGen()
  const python = tryRun('python3', ['--version']).status === 0 ? 'python3' : 'python'
  const gen = tryRun(python, [nvsGen, 'generate', csvPath, binPath, String(nvs.size)])
  if (gen.status !== 0 || !existsSync(binPath)) {
    die('nvs_partition_gen failed', (gen.stderr || gen.stdout || '').trim())
  }

  if (dryRun) {
    process.stdout.write(`\n--dry-run: image built (${statSync(binPath).size} bytes), NOT flashed.\n`)
    process.stdout.write(`Would write it to 0x${nvs.offset.toString(16)} on ${port}.\n`)
    process.stdout.write(`Expected fingerprint after provisioning: ${wantFpr}\n\n`)
    return
  }

  esptool(esp, port, chip, baud, ['write_flash', `0x${nvs.offset.toString(16)}`, binPath])

  // ── verify by reading it back ─────────────────────────────────────────────
  //
  // Not optional. A write_flash that reports success and a board that actually
  // holds the key are different claims, and the difference only shows up as a
  // MAC failure in a wood three weeks later — where it looks exactly like a dead
  // radio. Verify at the bench, where a cable is already attached.
  const afterPath = join(tmp, 'nvs-after.bin')
  esptool(esp, port, chip, baud, ['read_flash', `0x${nvs.offset.toString(16)}`, `0x${nvs.size.toString(16)}`, afterPath])
  const after = readFileSync(afterPath)
  const back = inspectNvs(after)
  const wrote = findPsk(back, after)

  if (!wrote || !wrote.payload) {
    die('read-back found no usable PSK entry', 'The write reported success. Do not put this board in the park.')
  }
  if (wrote.payload.length !== psk.length || !timingSafeEqual(wrote.payload, psk)) {
    die('read-back does not match the key that was written', 'Do not put this board in the park.')
  }
  const gotNs = back.namespaces.get(wrote.item.ns)
  if (gotNs !== NVS_NAMESPACE) {
    die(
      `the key landed in namespace "${gotNs}", not "${NVS_NAMESPACE}"`,
      'ql_crypto.h opens Preferences on QL_NVS_NAMESPACE and will not find it.',
    )
  }

  process.stdout.write(`\nProvisioned. Fingerprint: ${wantFpr}\n`)
  process.stdout.write('Power the board and confirm it prints the same eight characters —\n')
  process.stdout.write('the hub on its USB banner, a station on its service channel.\n')
  process.stdout.write('Every board in the park must show this value and no other.\n\n')
}

// ── one entry point, one cleanup path ───────────────────────────────────────
//
// Every route out of this program passes through the `finally` below, because
// between nvs_partition_gen and the write_flash there are two files on disk
// holding the park PSK in the clear. An early process.exit() anywhere above
// would skip this and leave them there.

let exitCode = 0
try {
  if (opt('--new')) mintNewKey()
  else if (opt('--fingerprint')) process.stdout.write(`${keyFingerprint(readKeyFile(opt('--fingerprint')))}\n`)
  else provisionBoard()
} catch (err) {
  if (err instanceof Abort) {
    process.stderr.write(`\nprovision-key: ${err.message}\n`)
    if (err.hint) process.stderr.write(`${err.hint}\n`)
    process.stderr.write('\n')
    exitCode = 1
  } else {
    process.stderr.write(`\nprovision-key: unexpected failure — ${err && err.stack ? err.stack : err}\n\n`)
    exitCode = 2
  }
} finally {
  // Zero, then remove. In that order: an unlink alone leaves the bytes in free
  // blocks. On an SSD even the overwrite is not a guarantee, which is one more
  // reason the park key belongs in a password manager and this copy of it lives
  // for seconds.
  if (tmp) {
    for (const name of ['psk.csv', 'psk-nvs.bin', 'nvs-before.bin', 'nvs-after.bin', 'ptable.bin']) {
      const p = join(tmp, name)
      try {
        if (existsSync(p)) writeFileSync(p, Buffer.alloc(statSync(p).size, 0))
      } catch {
        /* the rm below is the backstop */
      }
    }
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      process.stderr.write(`provision-key: could not remove ${tmp} — delete it by hand, it held key material.\n`)
    }
  }
}

process.exit(exitCode)
