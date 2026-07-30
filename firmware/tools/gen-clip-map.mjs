#!/usr/bin/env node
// gen-clip-map.mjs — the canon rotations to twenty-one SD cards and one header.
//
// Run it with:   node firmware/tools/gen-clip-map.mjs
// Check it with: node firmware/tools/gen-clip-map.mjs --check
//
// It writes two things and nothing else:
//
//   firmware/station/station_clips.h    the compiled answer to "is there a
//                                       recording for folder F track T on THIS
//                                       station's card?"
//   firmware/sdcard-manifests/st-NN.txt one per plinth: exactly which files a
//                                       human copies onto that card.
//
// ── WHY A CLIP MAP EXISTS AT ALL ────────────────────────────────────────────
//
// A DFPlayer told to play a track that is not on the card does not reliably do
// nothing. Depending on module revision it plays the numerically next file in
// the folder, replays the previous one, or reports an error several hundred
// milliseconds late — by which point a guest standing at a plinth they were
// never routed to has already heard the opening of somebody else's episode.
// station.ino therefore asks clipPresent() before every play command, and this
// generator is what makes that question answerable offline, in flash, with no
// SD directory scan on the critical path.
//
// Silence for an off-rotation tap is a DECISION (the user's no-fallback-audio
// mandate), and the clip map is how the decision is enforced rather than hoped
// for.
//
// ── THE ADDRESSING, AND WHY THE GAPS ARE THE POINT ──────────────────────────
//
//   folder = order   (1 Rangers, 2 Alehiim, 3 Elm, 4 RAID)
//   track  = episode number (1..10)
//
// So the two fields that ride the LoRa wire ARE the two arguments to
// df.playFolder(). Resolution is a struct copy; there is no lookup table, no
// per-station numbering, and nothing to get out of step.
//
// The consequence is that every card is SPARSE, and that is correct rather than
// untidy. st-03 Songcircle is on rangers episodes 1, 3, 4, 6 and 9 — so its
// folder 01 holds 001, 003, 004, 006, 009 and skips 002, 005, 007, 008, 010.
// Because track number is pinned to episode number FOREVER, adding a station to
// a new rotation is one file drop onto one card. If tracks were packed 001..00N
// instead, the same edit would renumber every file after the insertion point on
// that card, and every card that shares the episode, and the firmware would need
// a per-station index that could drift from the SD contents with no way to tell.
// The gaps are what buy that.
//
// ── WHERE THE DATA COMES FROM ───────────────────────────────────────────────
//
// content-intake/season-1.json is the stated authority for the rotations, and
// questland/src/content/stations.ts holds the same data in the shape the app
// uses. TWO COPIES OF ONE FACT IS THE FAILURE MODE THIS TOOL EXISTS INSIDE OF,
// so it reads the JSON, reads the TS, and refuses to emit anything if the two
// disagree by so much as one slot. The folder numbers are likewise read out of
// flagService.ORG_WIRE and cross-checked against ql_proto.h's QL_ORG_* defines
// rather than typed in here — this file is the fourth place those numbers could
// have been written down, and the whole point is that it is not.
//
// ── DETERMINISM IS A FEATURE, NOT A NICETY ──────────────────────────────────
//
// The output carries NO timestamp, NO hostname, NO input file mtime and no
// iteration over an unsorted Map. Same canon in, byte-identical bytes out. That
// is what lets `--check` be a drift guard in CI and what lets a bench operator
// diff a card against the header. If you add a "generated at" line to the
// banner you delete that property, and every regeneration becomes a diff nobody
// reads.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIRMWARE = resolve(HERE, '..')
const ROOT = resolve(FIRMWARE, '..')
const APP = join(ROOT, 'questland', 'src')

const OUT_HEADER = join(FIRMWARE, 'station', 'station_clips.h')
const OUT_MANIFESTS = join(FIRMWARE, 'sdcard-manifests')

const CHECK = process.argv.includes('--check')

// ── tiny readers ────────────────────────────────────────────────────────────

function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    die(`cannot read ${rel(path)}: ${err.message}`)
  }
}

function rel(path) {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path
}

function die(msg) {
  process.stderr.write(`gen-clip-map: ${msg}\n`)
  process.exit(1)
}

/**
 * `#define NAME value` out of a C header, numbers only.
 *
 * Deliberately narrow: it understands a decimal or hex literal with the integer
 * suffixes this project actually uses and NOTHING ELSE. A macro it cannot
 * evaluate is simply absent from the map, and every caller below asserts the
 * name it wanted is present — so an unparsed constant fails loudly here rather
 * than silently becoming `undefined` inside a folder number.
 */
function cDefines(src) {
  const out = new Map()
  const re = /^#define\s+(QL_[A-Z0-9_]+)\s+(.+?)\s*$/gm
  let m
  while ((m = re.exec(src)) !== null) {
    const raw = m[2].replace(/\/\*.*$/, '').replace(/\/\/.*$/, '').trim()
    const lit = raw.replace(/^\((.*)\)$/, '$1').trim().replace(/(u|ul|ull|l|ll)$/i, '')
    if (/^-?0[xX][0-9a-fA-F]+$/.test(lit) || /^-?\d+$/.test(lit)) {
      out.set(m[1], Number(lit))
    }
  }
  return out
}

function need(map, name, where) {
  if (!map.has(name)) die(`${where} does not define ${name} as a plain integer`)
  return map.get(name)
}

// ── canon: the three orders ─────────────────────────────────────────────────

function readOrgs() {
  const src = read(join(APP, 'content', 'orgs.ts'))
  const re = /id:\s*'([a-z]+)',\s*\n\s*name:\s*(['"])((?:\\.|(?!\2).)*)\2/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) out.push({ id: m[1], name: unesc(m[3]) })
  if (out.length !== 3) die(`expected 3 organizations in orgs.ts, parsed ${out.length}`)
  return out
}

function unesc(s) {
  return s.replace(/\\(['"\\])/g, '$1')
}

/**
 * The wire folder numbers, read from the app rather than restated here.
 *
 * flagService's own comment says it best: these numbers are PHYSICAL — they are
 * written on twenty-one SD cards — so renumbering them means re-cutting every
 * card in the park. Reading them means this generator cannot be the place the
 * park's audio quietly moves folder.
 */
function readOrgWire() {
  const src = read(join(APP, 'services', 'flagService.ts'))
  const m = /const ORG_WIRE:\s*Record<string,\s*number>\s*=\s*\{([^}]*)\}/.exec(src)
  if (!m) die('flagService.ts no longer declares ORG_WIRE in the shape this tool reads')
  const out = new Map()
  for (const pair of m[1].split(',')) {
    const kv = /^\s*([a-z]+)\s*:\s*(\d+)\s*$/.exec(pair)
    if (kv) out.set(kv[1], Number(kv[2]))
  }
  if (out.size === 0) die('parsed ORG_WIRE but found no entries')
  return out
}

// ── canon: the 21 stations ──────────────────────────────────────────────────

function readStations() {
  const src = read(join(APP, 'content', 'stations.ts'))
  const re =
    /\{\s*id:\s*'(st-\d\d)',\s*name:\s*(['"])((?:\\.|(?!\2).)*)\2,\s*type:\s*'([a-z]+)',\s*orgId:\s*(null|'[a-z]+')\s*\}/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) {
    out.push({
      id: m[1],
      name: unesc(m[3]),
      type: m[4],
      orgId: m[5] === 'null' ? null : m[5].slice(1, -1),
    })
  }
  if (out.length !== 21) die(`expected 21 stations in stations.ts, parsed ${out.length}`)
  return out
}

function readEpisodeStations() {
  const src = read(join(APP, 'content', 'stations.ts'))
  const re = /\{\s*episodeId:\s*'([a-z]{2}-\d\d)',\s*stationIds:\s*\[([^\]]*)\]\s*\}/g
  const out = new Map()
  let m
  while ((m = re.exec(src)) !== null) {
    const ids = [...m[2].matchAll(/'(st-\d\d)'/g)].map((x) => x[1])
    out.set(m[1], ids)
  }
  if (out.size !== 30) die(`expected 30 rotations in EPISODE_STATIONS, parsed ${out.size}`)
  return out
}

function readEpisodes() {
  const src = read(join(APP, 'content', 'quests.ts'))
  const re =
    /id:\s*'([a-z]{2}-\d\d)',\s*\n\s*orgId:\s*'([a-z]+)',\s*\n\s*number:\s*(\d+),\s*\n\s*title:\s*(['"])((?:\\.|(?!\4).)*)\4/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) {
    out.push({ id: m[1], orgId: m[2], number: Number(m[3]), title: unesc(m[5]) })
  }
  if (out.length !== 30) die(`expected 30 episodes in quests.ts, parsed ${out.length}`)
  return out
}

// ── canon: season-1.json, the stated authority ──────────────────────────────

/**
 * Names are compared through this. The JSON and the TS were typed by different
 * hands at different times, so one may carry a typographic apostrophe where the
 * other carries an ASCII one — a difference that means nothing about the park
 * and would otherwise abort a build. STATION NUMBERS are compared literally and
 * are never normalised: the number is the load-bearing half of "7. Abbey Hill
 * Ruins", and it is the half that decides which card a recording lands on.
 */
function loose(s) {
  return s
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function readSeason() {
  const raw = read(join(ROOT, 'content-intake', 'season-1.json'))
  let json
  try {
    json = JSON.parse(raw)
  } catch (err) {
    die(`content-intake/season-1.json is not valid JSON: ${err.message}`)
  }
  if (!Array.isArray(json.organizations)) die('season-1.json has no organizations array')
  return json
}

// ── build ───────────────────────────────────────────────────────────────────

function build() {
  const orgs = readOrgs()
  const orgWire = readOrgWire()
  const stations = readStations()
  const rotations = readEpisodeStations()
  const episodes = readEpisodes()
  const season = readSeason()

  const proto = cDefines(read(join(FIRMWARE, 'ql_proto.h')))
  const stationCfg = cDefines(read(join(FIRMWARE, 'station', 'config.h')))

  const FOLDER_SYSTEM = need(proto, 'QL_FOLDER_SYSTEM', 'ql_proto.h')
  const FOLDER_AMBIENCE = need(proto, 'QL_FOLDER_AMBIENCE', 'ql_proto.h')
  const TRK_OUT_OF_SERVICE = need(proto, 'QL_TRK_OUT_OF_SERVICE', 'ql_proto.h')
  const TRK_RETURN = need(proto, 'QL_TRK_RETURN', 'ql_proto.h')
  const ADDR_ST_MAX = need(proto, 'QL_ADDR_ST_MAX', 'ql_proto.h')
  const ADDR_PLINTH_MAX = need(proto, 'QL_ADDR_PLINTH_MAX', 'ql_proto.h')
  const ADDR_CHIEF = need(proto, 'QL_ADDR_CHIEF', 'ql_proto.h')
  const ADDR_GATE = need(proto, 'QL_ADDR_GATE', 'ql_proto.h')
  const EP_MAX = need(proto, 'QL_EP_MAX', 'ql_proto.h')
  const AMBIENCE_TRACKS = need(stationCfg, 'QL_AMBIENCE_TRACKS', 'station/config.h')

  // The folder numbers must agree in all three places that hold them.
  const protoOrg = {
    rangers: need(proto, 'QL_ORG_RANGERS', 'ql_proto.h'),
    alehiim: need(proto, 'QL_ORG_ALEHIIM', 'ql_proto.h'),
    elm: need(proto, 'QL_ORG_ELM', 'ql_proto.h'),
  }
  for (const [id, folder] of orgWire) {
    if (protoOrg[id] === undefined) die(`ORG_WIRE has '${id}' but ql_proto.h has no QL_ORG_ for it`)
    if (protoOrg[id] !== folder) {
      die(
        `folder number for '${id}' disagrees: flagService.ORG_WIRE says ${folder}, ` +
          `ql_proto.h says ${protoOrg[id]}. One of them is about to send twenty-one cards ` +
          `to the wrong folder — fix the source, do not "fix" this tool.`,
      )
    }
  }

  if (ADDR_PLINTH_MAX !== stations.length) {
    die(
      `ql_proto.h says QL_ADDR_PLINTH_MAX=${ADDR_PLINTH_MAX} but stations.ts holds ` +
        `${stations.length} plinths`,
    )
  }

  const byId = new Map(stations.map((s) => [s.id, s]))
  const orgById = new Map(orgs.map((o) => [o.id, o]))

  // Episode id prefix per order (rg / ah / el) is DERIVED from quests.ts rather
  // than restated: it is the one transform in this whole pipeline that does not
  // follow from the org id, and a second copy of it is a second thing to drift.
  const prefixByOrg = new Map()
  for (const ep of episodes) {
    const prefix = ep.id.split('-')[0]
    const known = prefixByOrg.get(ep.orgId)
    if (known && known !== prefix) die(`org '${ep.orgId}' has two episode prefixes: ${known}, ${prefix}`)
    prefixByOrg.set(ep.orgId, prefix)
  }

  const episodeById = new Map(episodes.map((e) => [e.id, e]))

  // ── the JSON half, and the cross-assertion ────────────────────────────────

  const problems = []
  /** episodeId -> { orgId, number, title, stationIds[7] } */
  const canon = new Map()

  for (const orgBlock of season.organizations) {
    const org = orgs.find((o) => loose(o.name) === loose(String(orgBlock.organization)))
    if (!org) {
      problems.push(`season-1.json names an order the app does not have: "${orgBlock.organization}"`)
      continue
    }
    const prefix = prefixByOrg.get(org.id)
    for (const epBlock of orgBlock.episodes ?? []) {
      const number = Number(epBlock.episode)
      if (!Number.isInteger(number) || number < 1 || number > EP_MAX) {
        problems.push(`${org.id}: episode number ${epBlock.episode} is outside 1..${EP_MAX}`)
        continue
      }
      const episodeId = `${prefix}-${String(number).padStart(2, '0')}`
      const slots = epBlock.stations ?? []
      if (slots.length !== 7) {
        problems.push(`${episodeId}: ${slots.length} stations in season-1.json, expected 7`)
        continue
      }
      const ids = []
      for (const slot of slots) {
        const m = /^\s*(\d{1,2})\.\s*(.+?)\s*$/.exec(String(slot))
        if (!m) {
          problems.push(`${episodeId}: cannot read station slot "${slot}" (expected "N. Name")`)
          continue
        }
        const n = Number(m[1])
        const id = `st-${String(n).padStart(2, '0')}`
        const station = byId.get(id)
        if (!station) {
          problems.push(`${episodeId}: slot "${slot}" points at ${id}, which is not a canon station`)
          continue
        }
        if (loose(station.name) !== loose(m[2])) {
          problems.push(
            `${episodeId}: slot "${slot}" is ${id}, but stations.ts calls ${id} "${station.name}"`,
          )
        }
        ids.push(id)
      }
      if (ids.length !== 7) continue
      if (new Set(ids).size !== 7) problems.push(`${episodeId}: a station appears twice in one rotation`)

      const ts = rotations.get(episodeId)
      if (!ts) {
        problems.push(`${episodeId}: present in season-1.json, absent from EPISODE_STATIONS`)
      } else if (ts.join(' ') !== ids.join(' ')) {
        problems.push(
          `${episodeId}: rotation disagrees\n` +
            `    season-1.json  ${ids.join(' ')}\n` +
            `    stations.ts    ${ts.join(' ')}`,
        )
      }

      const known = episodeById.get(episodeId)
      if (!known) {
        problems.push(`${episodeId}: present in season-1.json, absent from EPISODES`)
      } else {
        if (known.number !== number) {
          problems.push(`${episodeId}: number ${number} in JSON, ${known.number} in quests.ts`)
        }
        if (loose(known.title) !== loose(String(epBlock.title ?? ''))) {
          problems.push(
            `${episodeId}: title disagrees — JSON "${epBlock.title}", quests.ts "${known.title}"`,
          )
        }
      }

      canon.set(episodeId, { orgId: org.id, number, title: known?.title ?? String(epBlock.title), stationIds: ids })
    }
  }

  for (const episodeId of rotations.keys()) {
    if (!canon.has(episodeId)) problems.push(`${episodeId}: in EPISODE_STATIONS, absent from season-1.json`)
  }

  if (problems.length) {
    process.stderr.write('gen-clip-map: the canon does not agree with itself, nothing written.\n\n')
    for (const p of problems) process.stderr.write(`  - ${p}\n`)
    process.stderr.write(
      '\nFix the content, not this tool. Twenty-one SD cards are cut from whichever\n' +
        'side you decide is right, and a wrong slot is a guest hearing another\n' +
        "order's episode at a plinth they were never routed to.\n",
    )
    process.exit(1)
  }

  // ── the clip map ──────────────────────────────────────────────────────────
  //
  // One entry per (station, order, episode) triple. A station is in a rotation
  // at most once, so a card never holds two recordings for one (folder, track)
  // and the per-station key run is strictly ascending — which is what makes the
  // binary search in station.ino's clipPresent() legal.

  /** stationId -> Map<key, {folder, track, episodeId}> */
  const clips = new Map(stations.map((s) => [s.id, new Map()]))

  const sortedEpisodeIds = [...canon.keys()].sort()
  for (const episodeId of sortedEpisodeIds) {
    const ep = canon.get(episodeId)
    const folder = orgWire.get(ep.orgId)
    if (folder === undefined) die(`no wire folder for org '${ep.orgId}'`)
    for (const stationId of ep.stationIds) {
      const key = (folder << 8) | ep.number
      const run = clips.get(stationId)
      if (run.has(key)) {
        die(
          `${stationId} would need two recordings for folder ${folder} track ${ep.number} ` +
            `(${run.get(key).episodeId} and ${episodeId}). Track number IS episode number, ` +
            `so this cannot be resolved by renumbering — it means two episodes share a number.`,
        )
      }
      run.set(key, { folder, track: ep.number, episodeId })
    }
  }

  // A fingerprint of the canon this output was cut from. Deterministic, derived
  // only from the rotation data, and printed on every card manifest and in the
  // header — so "is this card the same season as this firmware" is one glance
  // rather than a diff of 210 lines.
  const canonHash = createHash('sha256')
    .update(
      sortedEpisodeIds
        .map((id) => `${id}|${canon.get(id).orgId}|${canon.get(id).number}|${canon.get(id).stationIds.join(',')}`)
        .join('\n'),
    )
    .digest('hex')
    .slice(0, 16)
    .toUpperCase()

  return {
    orgs,
    orgById,
    orgWire,
    stations,
    canon,
    sortedEpisodeIds,
    clips,
    canonHash,
    folders: { FOLDER_SYSTEM, FOLDER_AMBIENCE, TRK_OUT_OF_SERVICE, TRK_RETURN, AMBIENCE_TRACKS },
    addrs: { ADDR_ST_MAX, ADDR_PLINTH_MAX, ADDR_CHIEF, ADDR_GATE },
  }
}

// ── emit: station_clips.h ───────────────────────────────────────────────────

function renderHeader(model) {
  const { stations, clips, orgWire, orgById, canonHash, addrs } = model
  const { ADDR_ST_MAX, ADDR_PLINTH_MAX, ADDR_CHIEF, ADDR_GATE } = addrs

  const L = []
  L.push('// station_clips.h — GENERATED, DO NOT EDIT.')
  L.push('//')
  L.push('// Regenerate with:  npm run fw:clips      (node firmware/tools/gen-clip-map.mjs)')
  L.push('// Verify with:      node firmware/tools/gen-clip-map.mjs --check')
  L.push('//')
  L.push('// Source of truth: content-intake/season-1.json, cross-asserted slot for slot')
  L.push('// against questland/src/content/stations.ts (EPISODE_STATIONS) and quests.ts.')
  L.push(`// Canon fingerprint: ${canonHash}`)
  L.push('//')
  L.push('// ── The addressing ─────────────────────────────────────────────────────────')
  L.push('//')
  L.push('//   folder = order   ' + [...orgWire].map(([id, f]) => `${f} ${orgById.get(id)?.name ?? id}`).join(', '))
  L.push('//   track  = episode number, 1..10')
  L.push('//')
  L.push('// The two fields that ride the LoRa wire ARE the two arguments to')
  L.push('// df.playFolder(). Resolution is a struct copy, not a lookup.')
  L.push('//')
  L.push('// ── THE GAPS ARE THE POINT ─────────────────────────────────────────────────')
  L.push('//')
  L.push('// Every card is sparse and that is correct. Track number is pinned to episode')
  L.push('// number FOREVER, so adding a station to a new rotation is ONE FILE DROP onto')
  L.push('// one card. Pack the tracks 001..00N instead and the same edit renumbers every')
  L.push('// file after it on that card, and on every card sharing the episode, and the')
  L.push('// firmware needs a per-station index that can drift from the SD contents with')
  L.push('// nothing able to notice. Do not "tidy" the gaps.')
  L.push('//')
  L.push('// ── Shape ──────────────────────────────────────────────────────────────────')
  L.push('//')
  L.push('// QL_CLIP_KEYS is one flat, ascending array of (folder << 8) | track. The keys')
  L.push('// for station N occupy the half-open range')
  L.push('//     [ QL_CLIP_INDEX[N], QL_CLIP_INDEX[N + 1] )')
  L.push('// so station.ino binary-searches a run. An EMPTY RUN IS LEGAL and means "this')
  L.push('// card carries ambience and system audio only":')
  L.push(`//     station 0            the hub, which has no card;`)
  L.push(`//     station ${ADDR_CHIEF}           the Chief's House — the quest start, not one of the`)
  L.push('//                          canon 21, on no rotation, earning no seal. If the park')
  L.push('//                          ever wants the chief to speak the episode brief, that')
  L.push('//                          is 30 new recordings and a line in this generator; it')
  L.push('//                          is empty because no such content exists, not by')
  L.push('//                          oversight;')
  L.push(`//     station ${ADDR_GATE}           the gate / Village of Queston, likewise.`)
  L.push('//')
  L.push('// Folder 4 (RAID: Brigand\'s Return) is allocated on the wire and deliberately')
  L.push('// unpopulated: the finale is prose in season-1.json with no station assignment')
  L.push('// to generate from. Emitting a guess here would be a fallback clip by another')
  L.push('// name, which is exactly what the no-fallback mandate forbids.')
  L.push('')
  L.push('#pragma once')
  L.push('')
  L.push('#include <stdint.h>')
  L.push('')
  L.push('#define QL_CLIPS_FORMAT 1')
  L.push(`#define QL_CLIP_STATION_MAX ${ADDR_ST_MAX}`)
  L.push('')
  L.push(`/** Canon this card set was cut from. Printed on every sdcard-manifests/st-NN.txt. */`)
  L.push(`#define QL_CLIP_CANON "${canonHash}"`)
  L.push('')

  // Flat key array, in station order, ascending within each run.
  const runs = []
  let total = 0
  for (let n = 0; n <= ADDR_ST_MAX; n++) {
    const station = n >= 1 && n <= ADDR_PLINTH_MAX ? stations[n - 1] : null
    const keys = station ? [...clips.get(station.id).keys()].sort((a, b) => a - b) : []
    runs.push({ n, station, keys, start: total })
    total += keys.length
  }

  L.push(`#define QL_CLIP_TOTAL ${total}`)
  L.push('')
  L.push(`static const uint16_t QL_CLIP_KEYS[QL_CLIP_TOTAL] = {`)
  for (const run of runs) {
    if (!run.station) continue
    if (run.keys.length === 0) continue
    const s = run.station
    const perFolder = new Map()
    for (const key of run.keys) {
      const folder = key >> 8
      if (!perFolder.has(folder)) perFolder.set(folder, [])
      perFolder.get(folder).push(key & 0xff)
    }
    const summary = [...perFolder.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([folder, tracks]) => `${folder}:{${tracks.join(',')}}`)
      .join(' ')
    L.push(`  // ${String(run.n).padStart(2, ' ')} ${s.id} ${s.name} (${s.type}) - ${run.keys.length} clips  ${summary}`)
    for (let i = 0; i < run.keys.length; i += 10) {
      const slice = run.keys.slice(i, i + 10).map((k) => `0x${k.toString(16).toUpperCase().padStart(4, '0')}`)
      L.push(`  ${slice.join(', ')},`)
    }
  }
  L.push('};')
  L.push('')
  L.push('/**')
  L.push(' * One more entry than there are places: the run for station N ends at')
  L.push(' * QL_CLIP_INDEX[N + 1], so station QL_CLIP_STATION_MAX needs an index after it.')
  L.push(' * Index 0 is the hub, which has no card.')
  L.push(' */')
  L.push('static const uint16_t QL_CLIP_INDEX[QL_CLIP_STATION_MAX + 2] = {')
  const idx = []
  for (const run of runs) idx.push(run.start)
  idx.push(total)
  for (let i = 0; i < idx.length; i += 12) {
    L.push(`  ${idx.slice(i, i + 12).join(', ')},`)
  }
  L.push('};')
  L.push('')
  return L.join('\n')
}

// ── emit: sdcard-manifests/st-NN.txt ────────────────────────────────────────

function renderManifest(model, station) {
  const { clips, canon, orgById, orgWire, canonHash, folders } = model
  const { FOLDER_SYSTEM, FOLDER_AMBIENCE, TRK_OUT_OF_SERVICE, TRK_RETURN, AMBIENCE_TRACKS } = folders

  const entries = [...clips.get(station.id).values()].sort(
    (a, b) => a.folder - b.folder || a.track - b.track,
  )

  const L = []
  L.push(`GENERATED - DO NOT EDIT, run npm run fw:clips`)
  L.push(`(node firmware/tools/gen-clip-map.mjs; source content-intake/season-1.json)`)
  L.push('')
  L.push(`SD CARD MANIFEST - ${station.id}  ${station.name}`)
  L.push(`Station type: ${station.type}${station.orgId ? `   base station of: ${orgById.get(station.orgId)?.name}` : ''}`)
  L.push(`LoRa address / console station number: ${Number(station.id.slice(3))}`)
  L.push(`Canon fingerprint: ${canonHash}`)
  L.push(`Speech files on this card: ${entries.length}`)
  L.push('')
  L.push('Card: 8 GB microSD, FAT32, 32 kB allocation unit, formatted by the SD')
  L.push('Association formatter. Folders named exactly two digits, files exactly three')
  L.push('digits plus .mp3 - that is what DFPlayer playFolder(folder, track) addresses.')
  L.push('Copy the folders in ascending order onto a freshly formatted card; some DFPlayer')
  L.push('revisions index by FAT directory order, and copying out of order is the classic')
  L.push('"right file, wrong track number" bench fault.')
  L.push('')
  L.push('THE GAPS ARE CORRECT. Track number is the episode number, forever. This card')
  L.push('carries only the episodes whose rotation includes this station, so the numbering')
  L.push('skips. Do not renumber to close a gap: adding this station to a new rotation')
  L.push('later must stay a single file drop.')
  L.push('')
  L.push('--- SPEECH (one per order + episode this station appears in) ---')
  L.push('')
  if (entries.length === 0) {
    L.push('  (none - this station is on no rotation)')
  } else {
    let folder = -1
    for (const entry of entries) {
      if (entry.folder !== folder) {
        folder = entry.folder
        const orgId = [...orgWire.entries()].find(([, f]) => f === folder)?.[0]
        L.push(`  folder ${String(folder).padStart(2, '0')}  ${orgById.get(orgId)?.name ?? 'unknown order'}`)
      }
      const ep = canon.get(entry.episodeId)
      L.push(
        `    /${String(entry.folder).padStart(2, '0')}/${String(entry.track).padStart(3, '0')}.mp3` +
          `   ep ${String(ep.number).padStart(2, '0')}  ${entry.episodeId}  ${ep.title}`,
      )
    }
  }
  L.push('')
  L.push('--- SYSTEM (identical on every card) ---')
  L.push('')
  L.push(`  folder ${String(FOLDER_SYSTEM).padStart(2, '0')}  station voice, no narrative content`)
  L.push(
    `    /${String(FOLDER_SYSTEM).padStart(2, '0')}/${String(TRK_OUT_OF_SERVICE).padStart(3, '0')}.mp3` +
      `   "this plinth is out of service" - played only on a hardware fault`,
  )
  L.push(
    `    /${String(FOLDER_SYSTEM).padStart(2, '0')}/${String(TRK_RETURN).padStart(3, '0')}.mp3` +
      `   "your standard is finished, return it to the booth" - played for a returned pole`,
  )
  L.push('')
  L.push(`  Tracks 001..${String(TRK_OUT_OF_SERVICE - 1).padStart(3, '0')} of folder ${String(FOLDER_SYSTEM).padStart(2, '0')} are RESERVED and intentionally absent.`)
  L.push('  There is no "sorry, one moment" clip and there must never be one: an')
  L.push('  unresolved tag leaves the station on ambience and asks the hub for the table.')
  L.push('  A hold clip is a fallback clip wearing a hat.')
  L.push('')
  L.push('--- AMBIENCE (identical on every card) ---')
  L.push('')
  L.push(`  folder ${String(FOLDER_AMBIENCE).padStart(2, '0')}  the plinth's idle bed, cycled so a long wait does not loop audibly`)
  for (let t = 1; t <= AMBIENCE_TRACKS; t++) {
    L.push(`    /${String(FOLDER_AMBIENCE).padStart(2, '0')}/${String(t).padStart(3, '0')}.mp3`)
  }
  L.push('')
  L.push(`  QL_AMBIENCE_TRACKS in station/config.h is ${AMBIENCE_TRACKS}. If you put a different`)
  L.push('  number of files here, the station will eventually ask for a track that is not')
  L.push('  on the card - and a DFPlayer asked for a missing track does not reliably do')
  L.push('  nothing. Change both or neither.')
  L.push('')
  L.push(`TOTAL FILES ON THIS CARD: ${entries.length + 2 + AMBIENCE_TRACKS}`)
  L.push('')
  return L.join('\n')
}

// ── main ────────────────────────────────────────────────────────────────────

const model = build()

const outputs = new Map()
outputs.set(OUT_HEADER, renderHeader(model))
for (const station of model.stations) {
  outputs.set(join(OUT_MANIFESTS, `${station.id}.txt`), renderManifest(model, station))
}

if (CHECK) {
  const drifted = []
  for (const [path, text] of outputs) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null
    if (current === null) drifted.push(`${rel(path)} is missing`)
    else if (current !== text) drifted.push(`${rel(path)} differs from the canon`)
  }
  // A stale manifest for a station that no longer exists is drift too.
  if (existsSync(OUT_MANIFESTS)) {
    for (const name of readdirSync(OUT_MANIFESTS).sort()) {
      if (!name.endsWith('.txt')) continue
      if (!outputs.has(join(OUT_MANIFESTS, name))) drifted.push(`${rel(join(OUT_MANIFESTS, name))} is orphaned`)
    }
  }
  if (drifted.length) {
    process.stderr.write('gen-clip-map --check: generated files are out of date.\n\n')
    for (const d of drifted) process.stderr.write(`  - ${d}\n`)
    process.stderr.write('\nRun: node firmware/tools/gen-clip-map.mjs\n')
    process.exit(1)
  }
  process.stdout.write(`gen-clip-map --check: clean (${outputs.size} files, canon ${model.canonHash})\n`)
  process.exit(0)
}

mkdirSync(dirname(OUT_HEADER), { recursive: true })
mkdirSync(OUT_MANIFESTS, { recursive: true })
for (const [path, text] of outputs) writeFileSync(path, text, 'utf8')

const counts = model.stations.map((s) => ({ id: s.id, name: s.name, n: model.clips.get(s.id).size }))
const total = counts.reduce((a, c) => a + c.n, 0)
const max = counts.reduce((a, c) => (c.n > a.n ? c : a), counts[0])
const min = counts.reduce((a, c) => (c.n < a.n ? c : a), counts[0])

process.stdout.write(`gen-clip-map: wrote ${rel(OUT_HEADER)} and ${model.stations.length} manifests\n`)
process.stdout.write(`  canon fingerprint ${model.canonHash}\n`)
process.stdout.write(`  ${total} speech files across ${model.stations.length} cards\n`)
process.stdout.write(`  most  ${max.n}  ${max.id} ${max.name}\n`)
process.stdout.write(`  least ${min.n}  ${min.id} ${min.name}\n`)
for (const c of counts) process.stdout.write(`    ${c.id}  ${String(c.n).padStart(2, ' ')}  ${c.name}\n`)
