// The day's station records.
//
// Presence is a live position — one row per guest, overwritten every time they
// check in. This is the log underneath it: every check-in, appended in order,
// kept after the party has gone home. It exists to be READ AFTER THE FACT — how
// long a party sat at the chief's house, which station eats twenty minutes,
// where a questline stalls — so it is written once and never revised.
//
// The unit is a RUN: one party (or one lone guest, a party of one) walking one
// episode. Its legs are the gate arrival, the quest taken up at the gate, the
// chief's house, and each station sealed after that. Runs are derived here
// rather than stored, so a leg that syncs in late still lands in the right walk.
//
// One leg per check-in EVENT, written by the device that tapped — a party moves
// as one and is one row, not one row per member. Party-mates' phones adopt the
// check-in for presence and progress (see presenceService.syncParty) but do not
// log it again.

import type { PresenceKind, QuestLeg } from '../types'
import { VILLAGE_PLACE } from '../content/stationMap'
import { load, save } from './store'
import * as cloudSync from './cloudSync'

const LOG_KEY = 'ql:questLog'

/** Newest-first, capped — a phone is not an archive. Export before the cap bites. */
const LOG_CAP = 2000

/** How far back a run will reach to claim the arrival it came in on. */
const ARRIVAL_REACH_MS = 6 * 60 * 60 * 1000

export type { QuestLeg }

/** A party walking one episode, with the times of every leg of it. */
export interface QuestRun {
  id: string
  groupId: string
  groupKind: 'party' | 'solo'
  groupName: string
  memberNames: string[]
  partySize: number
  orgId?: string
  orgName?: string
  episodeNumber?: number
  episodeTitle?: string
  passName?: string
  passCode?: string
  /** The gate check-in this walk came in on, when there is one on the log. */
  arrival?: QuestLeg
  /** Chief's house and stations, oldest first. Empty on an arrival-only visit. */
  legs: QuestLeg[]
  /** First leg of the run, the arrival included. */
  startedAt: number
  lastAt: number
  stationsDone: number
  stationsTotal: number
  sealed: boolean
}

// ── The log ───────────────────────────────────────────────────────────────────

export function listLegs(): QuestLeg[] {
  return load<QuestLeg[]>(LOG_KEY, [])
}

function setLegs(legs: QuestLeg[]): void {
  save(LOG_KEY, legs.sort((a, b) => b.at - a.at).slice(0, LOG_CAP))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar day of a timestamp — the park's day, not UTC's. */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function runIdFor(groupId: string, orgId?: string, episodeId?: string): string | undefined {
  if (!orgId || !episodeId) return undefined
  return `${groupId}|${orgId}|${episodeId}`
}

export interface LegInput {
  at: number
  userId: string
  byName: string
  group: { kind: 'party' | 'solo'; id: string; name: string; memberNames: string[] }
  kind: PresenceKind
  placeId: string
  placeName: string
  orgId?: string
  orgName?: string
  episodeId?: string
  episodeNumber?: number
  episodeTitle?: string
  legNumber?: number
  stationsTotal?: number
  sealed?: boolean
  passCode?: string
  passName?: string
}

/**
 * A place is walked once per episode, so a second tap at the same place on the
 * same run is the same leg — the first time is the true one. A gate arrival has
 * no run to key on, so it is deduped by a short window instead: a party
 * fumbling the check-in twice arrived once.
 */
const ARRIVAL_DEDUPE_MS = 30 * 60 * 1000

function isDuplicate(legs: QuestLeg[], leg: QuestLeg): boolean {
  return legs.some((l) => {
    if (l.groupId !== leg.groupId || l.placeId !== leg.placeId) return false
    if (leg.runId) return l.runId === leg.runId
    // Only another ARRIVAL can be the same arrival. Taking a quest up is filed
    // at the village too, so without the kind a party who paid in the car park
    // would have their walk through the gate swallowed minutes later.
    return l.kind === leg.kind && Math.abs(l.at - leg.at) < ARRIVAL_DEDUPE_MS
  })
}

/** Appends one leg and pushes it to the cloud log the Back Office reads. */
export function recordLeg(input: LegInput): QuestLeg | null {
  const runId = runIdFor(input.group.id, input.orgId, input.episodeId)
  const leg: QuestLeg = {
    id: `${input.group.id}:${input.placeId}:${input.at}`,
    at: input.at,
    userId: input.userId,
    byName: input.byName,
    groupId: input.group.id,
    groupKind: input.group.kind,
    groupName: input.group.name,
    partySize: Math.max(1, input.group.memberNames.length),
    memberNames: input.group.memberNames,
    kind: input.kind,
    placeId: input.placeId,
    placeName: input.placeName,
  }
  if (input.orgId) leg.orgId = input.orgId
  if (input.orgName) leg.orgName = input.orgName
  if (input.episodeId) leg.episodeId = input.episodeId
  if (input.episodeNumber !== undefined) leg.episodeNumber = input.episodeNumber
  if (input.episodeTitle) leg.episodeTitle = input.episodeTitle
  if (input.legNumber !== undefined) leg.legNumber = input.legNumber
  if (input.stationsTotal !== undefined) leg.stationsTotal = input.stationsTotal
  if (input.sealed) leg.sealed = true
  if (input.passCode) leg.passCode = input.passCode
  if (input.passName) leg.passName = input.passName
  // A gate arrival belongs to the visit, not to any one quest — it is joined to
  // the run it precedes when the log is read.
  if (runId && input.kind !== 'village') leg.runId = runId
  if (input.userId.startsWith('demo-')) leg.demo = true

  const legs = listLegs()
  if (isDuplicate(legs, leg)) return null
  setLegs([leg, ...legs])
  cloudSync.pushLeg(leg)
  return leg
}

/** Straight write, no dedupe and no cloud push — used to stage a demo world. */
export function seedLegs(legs: QuestLeg[]): void {
  const byId = new Map(listLegs().map((l) => [l.id, l] as const))
  legs.forEach((l) => byId.set(l.id, l))
  setLegs(Array.from(byId.values()))
}

export function clearLegsFor(userIds: string[]): void {
  const drop = new Set(userIds)
  setLegs(listLegs().filter((l) => !drop.has(l.userId)))
}

// ── Reading it back ───────────────────────────────────────────────────────────

/** Every day the log holds anything for, newest first. */
export function loggedDays(legs: QuestLeg[] = listLegs()): string[] {
  return Array.from(new Set(legs.map((l) => dayKey(l.at)))).sort((a, b) => b.localeCompare(a))
}

/**
 * Collapses the log into walks.
 *
 * A run is keyed on group + order + episode, so the same party walking two
 * episodes reads as two rows. A group that came through the gate and never took
 * a quest still gets a row — an empty walk says something the missing row would
 * not.
 */
export function questRuns(legs: QuestLeg[] = listLegs()): QuestRun[] {
  const asc = [...legs].sort((a, b) => a.at - b.at)
  const arrivals = asc.filter((l) => l.kind === 'village')
  const claimed = new Set<string>()

  const byRun = new Map<string, QuestLeg[]>()
  for (const leg of asc) {
    if (!leg.runId) continue
    const bucket = byRun.get(leg.runId)
    if (bucket) bucket.push(leg)
    else byRun.set(leg.runId, [leg])
  }

  const runs: QuestRun[] = []
  byRun.forEach((walk, id) => {
    const first = walk[0]
    const last = walk[walk.length - 1]
    // The gate check-in this walk came in on: the group's most recent arrival
    // before it started, within the reach of a single visit.
    const arrival = arrivals
      .filter(
        (a) =>
          a.groupId === first.groupId &&
          a.at <= first.at &&
          first.at - a.at <= ARRIVAL_REACH_MS
      )
      .pop()
    if (arrival) claimed.add(arrival.id)

    const stations = walk.filter((l) => l.kind === 'station')
    const named = walk.find((l) => l.passCode) ?? first
    runs.push({
      id,
      groupId: first.groupId,
      groupKind: first.groupKind,
      groupName: first.groupName,
      memberNames: last.memberNames ?? first.memberNames,
      partySize: last.partySize ?? first.partySize,
      orgId: first.orgId,
      orgName: first.orgName,
      episodeNumber: first.episodeNumber,
      episodeTitle: first.episodeTitle,
      passName: named.passName,
      passCode: named.passCode,
      arrival,
      legs: walk,
      startedAt: arrival ? arrival.at : first.at,
      lastAt: last.at,
      stationsDone: stations.length,
      stationsTotal: first.stationsTotal ?? 7,
      sealed: walk.some((l) => l.sealed),
    })
  })

  // An arrival that opened no walk is a visit with no quest taken — a row worth
  // keeping, because a group that came through the gate and stopped there is
  // exactly what this log is for. One that falls INSIDE a walk the group was
  // already on is not: it is the same visit checking in again, and giving it a
  // row of its own would list the party twice.
  const spans = runs.map((r) => ({ groupId: r.groupId, from: r.startedAt, to: r.lastAt }))
  for (const a of arrivals) {
    if (claimed.has(a.id)) continue
    if (spans.some((s) => s.groupId === a.groupId && a.at >= s.from && a.at <= s.to)) continue
    runs.push({
      id: `arrival:${a.id}`,
      groupId: a.groupId,
      groupKind: a.groupKind,
      groupName: a.groupName,
      memberNames: a.memberNames,
      partySize: a.partySize,
      arrival: a,
      legs: [],
      startedAt: a.at,
      lastAt: a.at,
      stationsDone: 0,
      stationsTotal: a.stationsTotal ?? 7,
      sealed: false,
    })
  }

  return runs.sort((a, b) => b.lastAt - a.lastAt)
}

/** Arrival first, then the walk — the run as a reader follows it. */
export function runLegs(run: QuestRun): QuestLeg[] {
  return run.arrival ? [run.arrival, ...run.legs] : run.legs
}

/** "Arrived" · "Quest taken" · "Called on the Chief" · "Station 3". */
export function legLabel(leg: QuestLeg): string {
  if (leg.kind === 'village') return 'Arrived'
  // Two legs of a walk open it: the quest bought at the gate and the chief's
  // house it starts from. Both are kind 'start', so the place is what tells them
  // apart — and the export is pivoted on this column, where one label covering
  // both would count every walk's quest twice.
  if (leg.kind === 'start') {
    return leg.placeId === VILLAGE_PLACE.id ? 'Quest taken' : 'Called on the Chief'
  }
  return leg.legNumber ? `Station ${leg.legNumber}` : 'Station'
}

/** Minutes from the run's first leg to its last. */
export function runMinutes(run: QuestRun): number {
  return Math.max(0, Math.round((run.lastAt - run.startedAt) / 60000))
}

// ── Export ────────────────────────────────────────────────────────────────────
//
// One row per LEG, not per run: it appends cleanly onto a master sheet day after
// day, and every question worth asking of it — time per station, time from gate
// to quest, which legs stall — is a pivot away.

const COLUMNS = [
  'date',
  'time',
  'group_type',
  'group',
  'party_size',
  'members',
  'order',
  'episode_number',
  'episode_title',
  'leg',
  'leg_number',
  'place_type',
  'place',
  'minutes_since_previous',
  'minutes_since_start',
  'sealed_episode',
  'passage',
  'passage_code',
  'checked_in_by',
  'run_id',
  'timestamp_iso',
]

/**
 * Excel evaluates a cell whose text opens with a formula character, and it does so
 * even when the CSV quoted the field — the quotes are stripped at parse time, so
 * they are structure, not protection. Party names and display names are chosen by
 * guests and land in this file, which is opened in a spreadsheet by design.
 *
 * The leading apostrophe is what makes the value text. It stays visible in the
 * imported cell, so a party genuinely named "-Vanguard" shows one; that is the
 * accepted cost, and it touches the export only, never the app.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/

function cell(value: string | number | undefined): string {
  const raw = value === undefined || value === null ? '' : String(value)
  const s = FORMULA_LEAD.test(raw) ? `'${raw}` : raw
  return `"${s.replace(/"/g, '""')}"`
}

function clockOf(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function toCsv(runs: QuestRun[]): string {
  const rows: string[] = [COLUMNS.join(',')]

  for (const run of [...runs].sort((a, b) => a.startedAt - b.startedAt)) {
    const legs = runLegs(run)
    legs.forEach((leg, i) => {
      const previous = i === 0 ? undefined : legs[i - 1]
      rows.push(
        [
          cell(dayKey(leg.at)),
          cell(clockOf(leg.at)),
          cell(run.groupKind === 'party' ? 'Party' : 'Solo'),
          cell(run.groupName),
          cell(run.partySize),
          cell(run.memberNames.join('; ')),
          cell(leg.orgName ?? run.orgName),
          cell(leg.episodeNumber ?? run.episodeNumber),
          cell(leg.episodeTitle ?? run.episodeTitle),
          cell(legLabel(leg)),
          cell(leg.legNumber),
          cell(leg.kind),
          cell(leg.placeName),
          cell(previous ? Math.round((leg.at - previous.at) / 60000) : ''),
          cell(Math.round((leg.at - run.startedAt) / 60000)),
          cell(leg.sealed ? 'yes' : 'no'),
          cell(leg.passName ?? run.passName),
          cell(leg.passCode ?? run.passCode),
          cell(leg.byName),
          cell(run.id),
          cell(new Date(leg.at).toISOString()),
        ].join(',')
      )
    })
  }

  return rows.join('\r\n')
}

/** Hands the browser a .csv file. Nothing leaves the device but the download. */
export function downloadCsv(csv: string, filename: string): void {
  // The BOM is what makes Excel open UTF-8 correctly on Windows.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
