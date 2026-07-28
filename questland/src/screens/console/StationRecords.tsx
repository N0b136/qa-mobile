// The day's log: every party, every quest, every leg, with the times.
//
// The park board upstairs answers "where is everybody"; this answers "how did
// the day actually run". One row per walk — a party and the episode they took —
// opening onto the legs of it, each with the clock time it was checked in at and
// the minutes it took to get there from the last one. Those gaps are the point:
// they are what says a station eats twenty minutes or that parties sit at the
// chief's house too long.
//
// Export writes a row per LEG, which is the shape that appends onto a master
// spreadsheet day after day and pivots into anything worth asking.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import {
  dayKey,
  downloadCsv,
  legLabel,
  listLegs,
  loggedDays,
  questRuns,
  runLegs,
  runMinutes,
  toCsv,
} from '../../services/questLogService'
import type { QuestLeg, QuestRun } from '../../services/questLogService'
import { romanNumeral } from '../questIcons'
import type { SelectOption } from '../../ui'
import { Badge, Button, Card, Icon, Select } from '../../ui'

const ALL = 'all'

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** '2026-07-28' → 'Tue 28 Jul' — a label a Warden can scan. */
function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function questOf(run: QuestRun): string {
  if (!run.orgName) return 'No quest taken'
  const parts = [run.orgName]
  if (run.episodeNumber) parts.push(`Episode ${romanNumeral(run.episodeNumber)}`)
  return parts.join(' · ')
}

function gap(leg: QuestLeg, previous: QuestLeg | undefined): string {
  if (!previous) return ''
  const mins = Math.round((leg.at - previous.at) / 60000)
  return mins < 1 ? '+ under a minute' : `+ ${mins} min`
}

const headCell: CSSProperties = {
  padding: '0 12px 8px 0',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  font: 'var(--label-ui)',
  letterSpacing: 'var(--tracking-label)',
  textTransform: 'uppercase',
  color: 'var(--text-gold)',
}

const bodyCell: CSSProperties = {
  padding: '10px 12px 10px 0',
  verticalAlign: 'top',
  fontSize: 13,
  color: 'var(--text-body)',
}

export default function StationRecords() {
  const [day, setDay] = useState<string>(() => dayKey(Date.now()))
  const [open, setOpen] = useState<string | null>(null)

  const all = listLegs()
  const days = loggedDays(all)
  const today = dayKey(Date.now())

  // Today is always offered, even before the first check-in of it lands.
  const dayOptions: SelectOption[] = [
    { value: today, label: 'Today' },
    ...days.filter((d) => d !== today).map((d) => ({ value: d, label: dayLabel(d) })),
    { value: ALL, label: `All records (${days.length} ${days.length === 1 ? 'day' : 'days'})` },
  ]

  const legs = day === ALL ? all : all.filter((l) => dayKey(l.at) === day)
  const runs = questRuns(legs)
  const groups = new Set(runs.map((r) => r.groupId)).size
  const sealed = runs.filter((r) => r.sealed).length

  return (
    <Card eyebrow="The day's log" title="Station Records" style={{ gridColumn: '1 / -1' }}>
      <div
        className="row"
        style={{ gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}
      >
        <Select
          label="Day"
          options={dayOptions}
          value={day}
          onChange={(e) => {
            setDay(e.target.value)
            setOpen(null)
          }}
          style={{ minWidth: 220 }}
        />
        <div style={{ flex: '1 1 auto' }} />
        <Button
          icon="download"
          variant="secondary"
          disabled={legs.length === 0}
          onClick={() =>
            downloadCsv(
              toCsv(runs),
              `questland-station-records-${day === ALL ? 'all' : day}.csv`
            )
          }
        >
          Export CSV
        </Button>
      </div>

      {legs.length === 0 ? (
        <p className="muted">
          No records for this day yet. The log fills as parties check in at the gate, take a quest
          and walk the stations.
        </p>
      ) : (
        <>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
            <Stat icon="scroll-text" text={`${runs.length} ${runs.length === 1 ? 'walk' : 'walks'}`} />
            <Stat icon="users" text={`${groups} ${groups === 1 ? 'group' : 'groups'}`} />
            <Stat icon="map-pin" text={`${legs.length} check-ins`} />
            <Stat icon="badge-check" text={`${sealed} sealed`} />
          </div>

          <div className="console-x-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                  <th style={headCell}>Party</th>
                  <th style={headCell}>Quest</th>
                  <th style={headCell}>Arrived</th>
                  <th style={headCell}>Quest taken</th>
                  <th style={headCell}>Stations</th>
                  <th style={headCell}>Last leg</th>
                  <th style={headCell}>Elapsed</th>
                  <th style={headCell} aria-label="Legs" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    open={open === run.id}
                    onToggle={() => setOpen(open === run.id ? null : run.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

function Stat({ icon, text }: { icon: string; text: string }) {
  return (
    <span className="row muted" style={{ gap: 6, fontSize: 13 }}>
      <Icon name={icon} size={14} />
      {text}
    </span>
  )
}

function RunRow({ run, open, onToggle }: { run: QuestRun; open: boolean; onToggle: () => void }) {
  const legs = runLegs(run)
  const start = run.legs.find((l) => l.kind === 'start')

  return (
    <>
      <tr style={{ borderBottom: open ? 'none' : '1px solid var(--border-hairline)' }}>
        <td style={bodyCell}>
          <span className="row" style={{ gap: 7 }}>
            <Icon name={run.groupKind === 'party' ? 'users' : 'user'} size={14} />
            <strong style={{ color: 'var(--text-heading)' }}>{run.groupName}</strong>
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            {run.partySize} {run.partySize === 1 ? 'traveller' : 'travellers'}
          </span>
        </td>
        <td style={bodyCell}>
          {questOf(run)}
          {run.episodeTitle ? (
            <div className="muted" style={{ fontSize: 12 }}>
              {run.episodeTitle}
            </div>
          ) : null}
        </td>
        <td style={bodyCell}>{run.arrival ? clock(run.arrival.at) : '—'}</td>
        <td style={bodyCell}>{start ? clock(start.at) : '—'}</td>
        <td style={bodyCell}>
          {run.stationsDone} of {run.stationsTotal}
          {run.sealed ? (
            <>
              {' '}
              <Badge tone="gold" icon="badge-check">
                Sealed
              </Badge>
            </>
          ) : null}
        </td>
        <td style={bodyCell}>{clock(run.lastAt)}</td>
        <td style={bodyCell}>{runMinutes(run)} min</td>
        <td style={{ ...bodyCell, textAlign: 'right' }}>
          <Button variant="ghost" size="sm" icon={open ? 'chevron-up' : 'chevron-down'} onClick={onToggle}>
            {legs.length} {legs.length === 1 ? 'leg' : 'legs'}
          </Button>
        </td>
      </tr>

      {open ? (
        <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
          <td colSpan={8} style={{ padding: '0 0 14px' }}>
            <div
              style={{
                borderLeft: '1px solid var(--border-hairline)',
                paddingLeft: 14,
                marginLeft: 4,
              }}
            >
              {run.passCode ? (
                <p className="row muted" style={{ gap: 6, margin: '0 0 8px', fontSize: 12 }}>
                  <Icon name="ticket-check" size={12} />
                  {run.passName ?? 'Passage'} · {run.passCode}
                </p>
              ) : null}
              {run.groupKind === 'party' ? (
                <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
                  {run.memberNames.join(', ')}
                </p>
              ) : null}

              {legs.map((leg, i) => (
                <div
                  key={leg.id}
                  className="row"
                  style={{ gap: 10, padding: '5px 0', fontSize: 13, flexWrap: 'wrap' }}
                >
                  <span
                    style={{
                      minWidth: 52,
                      color: 'var(--text-gold)',
                      font: '700 var(--text-xs)/1 var(--font-ui)',
                      letterSpacing: '.06em',
                    }}
                  >
                    {clock(leg.at)}
                  </span>
                  <Icon
                    name={leg.kind === 'village' ? 'castle' : leg.kind === 'start' ? 'house' : 'map-pin'}
                    size={13}
                  />
                  <span style={{ color: 'var(--text-heading)' }}>{legLabel(leg)}</span>
                  <span className="muted">{leg.placeName}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {gap(leg, i === 0 ? undefined : legs[i - 1])}
                  </span>
                  {leg.sealed ? <Badge tone="gold" icon="badge-check">Episode sealed</Badge> : null}
                </div>
              ))}

              <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                Checked in by {legs[legs.length - 1]?.byName ?? 'a guest'}
              </p>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
