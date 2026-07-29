// The ticket booth.
//
// A party arrives, an employee binds them to a standard, a questline and one
// episode, and the Passage is spent — those are one action, because holding a
// bound pole IS the proof of payment. At the other end of the day the same party
// hands the pole back over the same counter.
//
// ── THE PAD IS TWO-WAY, AND THAT IS THE WHOLE RISK IN THIS PANEL ───────────
//
// Binding and checking out are the same physical gesture: a tag on a pad. The
// flag's own status decides which one it is — a racked pole opens the bind form,
// a bound or sealed one opens "Complete the quest". An employee does this fifty
// times a day, so the two stages are never allowed to look alike: different rule
// colour, different glyph, different verb, and a read-back said out loud before
// either commits. Mistaking a completion for a bind would take a party off the
// board mid-walk; mistaking a bind for a completion would charge them twice.
//
// The invite-code field is CONSTRAINED, not merely validated. A USB wedge
// scanner is a keyboard, an always-focused field accepts whatever it types, and
// what it types includes Enter and Tab. So the field keeps six upper-case
// alphanumerics and discards everything else at the point of input.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUser } from '../../services/authService'
import { listDirectory } from '../../services/consoleService'
import { getPartyByCode, getUserParty } from '../../services/partyService'
import { currentEpisode } from '../../services/progressService'
// Aliased: `useForEpisode` reads a ledger, it is not a React hook, and the
// rules-of-hooks lint has no way to tell those apart by name.
import { passStates, passStatusLabel, useForEpisode as passSpentOn } from '../../services/passService'
import type { PassState } from '../../services/passService'
import { checkInAtGate } from '../../services/presenceService'
import { broadcastRow } from '../../services/tapService'
import * as hubLink from '../../services/hubLink'
import {
  bindFlag,
  completeFlag,
  flagByUid,
  flagStates,
  markFound,
  markLost,
  nextLabel,
  normalizeUid,
  releaseFlag,
  retireFlag,
} from '../../services/flagService'
import type { FlagState } from '../../services/flagService'
import type { Flag } from '../../types'
import { ORGS, getOrg } from '../../content/orgs'
import { episodesFor, getEpisode } from '../../content/quests'
import { useToast } from '../../components/Toast'
import type { SelectOption } from '../../ui'
import { Badge, Button, Card, Dialog, Icon, Input, Select } from '../../ui'
import { romanNumeral } from '../questIcons'
import './booth.css'

interface Props {
  /** Staff uid, stored on the binding. Deliberately never a staff NAME. */
  staffUid: string
}

/** The party invite code, exactly as PartyScreen mints it. */
const CODE_RE = /^[A-Z0-9]{6}$/

const CODE_FIELD_ID = 'booth-invite-code'

type Stage = 'idle' | 'bind' | 'complete'

/** The tag on the pad, and whether the rack has ever seen it. */
interface PadTag {
  uid: string
  label: string
  known: boolean
}

interface PassageRow {
  memberId: string
  memberName: string
  state: PassState
}

function poleClass(s: FlagState): string {
  if (s.flag.status === 'lost' || s.overdue) return 'booth__pole booth__pole--flagged'
  if (s.flag.status === 'retired') return 'booth__pole booth__pole--retired'
  if (s.flag.status === 'sealed') return 'booth__pole booth__pole--sealed'
  if (s.flag.status === 'bound') return 'booth__pole booth__pole--out'
  return 'booth__pole'
}

function poleGlyph(flag: Flag): string {
  switch (flag.status) {
    case 'bound':
      return 'flag'
    case 'sealed':
      return 'flag-triangle-right'
    case 'lost':
      return 'triangle-alert'
    case 'retired':
      return 'flag-off'
    default:
      return 'flag'
  }
}

function outFor(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000))
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rest = mins % 60
  return rest === 0 ? `${hrs} hr` : `${hrs} hr ${rest} min`
}

export default function BoothPanel({ staffUid }: Props) {
  const toast = useToast()
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const [stage, setStage] = useState<Stage>('idle')
  const [tag, setTag] = useState<PadTag | null>(null)

  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | undefined>(undefined)
  const [nameQuery, setNameQuery] = useState('')

  const [holderId, setHolderId] = useState('')
  const [orgChoice, setOrgChoice] = useState('')
  const [episodeChoice, setEpisodeChoice] = useState('')
  const [bookingId, setBookingId] = useState('')

  const [busy, setBusy] = useState(false)
  const [openPole, setOpenPole] = useState<Flag | null>(null)

  const reset = useCallback(() => {
    setStage('idle')
    setTag(null)
    setCode('')
    setCodeError(undefined)
    setNameQuery('')
    setHolderId('')
    setOrgChoice('')
    setEpisodeChoice('')
    setBookingId('')
    refresh()
  }, [refresh])

  // ── The pad ───────────────────────────────────────────────────────────────

  /**
   * One tag, presented at the counter. The flag's status — not a mode the
   * employee had to remember to set — decides whether this opens a binding or
   * closes a walk.
   */
  const presentTag = useCallback(
    (rawUid: string) => {
      const uid = normalizeUid(rawUid)
      if (!uid) {
        // Rejected, not repaired. A uid we cannot vouch for is an unknown tag.
        toast.show({ title: 'That tag could not be read', body: 'Present it to the pad again.', icon: 'scan-line' })
        return
      }
      const flag = flagByUid(uid)

      if (flag && (flag.status === 'bound' || flag.status === 'sealed')) {
        setTag({ uid, label: flag.label, known: true })
        setStage('complete')
        return
      }
      if (flag && flag.status === 'lost') {
        setOpenPole(flag)
        toast.show({ title: `${flag.label} is marked lost`, body: 'Mark it found before binding it again.', icon: 'triangle-alert' })
        return
      }
      if (flag && flag.status === 'retired') {
        toast.show({ title: `${flag.label} is retired`, body: 'Take another from the rack.', icon: 'flag-off' })
        return
      }

      setTag({ uid, label: flag?.label ?? nextLabel(), known: !!flag })
      setStage('bind')
    },
    [toast]
  )

  // The physical pad. Same entry point the rack chips use, so a mouse and a tag
  // reader cannot diverge in behaviour.
  useEffect(() => hubLink.onBoothTag((frame) => presentTag(frame.uid)), [presentTag])

  // ── The invite code ───────────────────────────────────────────────────────

  const focusCode = useCallback(() => {
    document.getElementById(CODE_FIELD_ID)?.focus()
  }, [])

  useEffect(() => {
    if (stage === 'idle' && !holderId) focusCode()
  }, [stage, holderId, focusCode])

  const blurTimer = useRef<number | null>(null)

  /**
   * Keeps the scanner's keystrokes landing in the right field WITHOUT trapping
   * the employee out of the rest of the form: focus is only recovered when it
   * fell off the panel entirely, and only while nothing else is being filled in.
   */
  function recoverFocus(): void {
    if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
    blurTimer.current = window.setTimeout(() => {
      blurTimer.current = null
      if (stage !== 'idle' || holderId) return
      const active = document.activeElement
      if (!active || active === document.body) focusCode()
    }, 0)
  }

  useEffect(
    () => () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
    },
    []
  )

  const resolveCode = useCallback(
    (value: string) => {
      if (!CODE_RE.test(value)) {
        setCodeError('An invite code is six letters or numbers.')
        return
      }
      const party = getPartyByCode(value)
      if (!party) {
        setCodeError('No party answers to that code.')
        return
      }
      const first = party.memberIds.find((id) => getUser(id))
      if (!first) {
        setCodeError('That party has nobody on the roll.')
        return
      }
      setCodeError(undefined)
      setHolderId(first)
      setNameQuery('')
    },
    []
  )

  function onCodeChange(raw: string): void {
    // Constrained at the point of input: upper-cased, six characters, and
    // anything that is not a letter or a digit is simply dropped.
    const next = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    setCode(next)
    if (codeError) setCodeError(undefined)
    if (next.length === 6) resolveCode(next)
  }

  // ── The party being bound ─────────────────────────────────────────────────

  const holder = holderId ? getUser(holderId) : null
  const party = holderId ? getUserParty(holderId) : null
  const roster = useMemo(
    () => (party ? party.memberIds : holderId ? [holderId] : []),
    [party, holderId]
  )
  const groupName = party?.name ?? holder?.name ?? ''

  // Order and episode are DERIVED unless staff say otherwise, so the form
  // follows the party as it is identified and only stops following once an
  // override has actually been chosen.
  const orgId = orgChoice || holder?.orgId || ORGS[0].id
  const derivedEpisode = holderId ? currentEpisode(holderId, orgId) : null
  const chosenEpisode = episodeChoice ? getEpisode(episodeChoice) : undefined
  const episode = chosenEpisode && chosenEpisode.orgId === orgId ? chosenEpisode : derivedEpisode

  // The episode is CONFIRMED at this counter, not chosen.
  //
  // Nothing downstream reads the binding's episode: the chief asks the ledger
  // about the guest's next unsealed one, and every station credits that same one.
  // So a bind written for any other episode charges a Passage for a walk the park
  // will then refuse at the chief's door. `bindFlag` enforces it; naming the
  // episode is still worth doing as a compare-and-set, because this form can sit
  // open while the party seals something out in the woods. The Select therefore
  // stays — a Guide needs to see where a party stands on the questline — but a
  // mismatch is said plainly and cannot be committed.
  const overridden = !!derivedEpisode && !!episode && episode.id !== derivedEpisode.id

  const passages: PassageRow[] = useMemo(() => {
    const rows: PassageRow[] = []
    roster.forEach((id) => {
      const member = getUser(id)
      if (!member) return
      passStates(id).forEach((state) => rows.push({ memberId: id, memberName: member.name, state }))
    })
    return rows.sort((a, b) => Number(b.state.status === 'valid') - Number(a.state.status === 'valid'))
    // `tick` is in the deps on purpose: a bind spends a Quest Experience, and
    // the list beneath must show that the moment it does.
  }, [roster, tick])

  const selectedPassage = passages.find((p) => p.state.booking.id === bookingId)

  // Already paid for? Then no passage need be presented. `redeem` is idempotent
  // per (guest, order, episode), so re-reading a binding at the counter — a Hero
  // party back for the same episode, a mis-scan corrected — costs nothing.
  const alreadyPaid = !!holderId && !!episode && passSpentOn(holderId, orgId, episode.id) !== null

  function selectPassage(row: PassageRow): void {
    // The passage is spent against the guest who holds it, so presenting a
    // party-mate's passage makes THEM the holder of the walk.
    setHolderId(row.memberId)
    setBookingId(row.state.booking.id)
  }

  const episodeOptions: SelectOption[] = episodesFor(orgId).map((e) => ({
    value: e.id,
    label: `Episode ${romanNumeral(e.number)} — ${e.title}`,
  }))

  // ── Committing ────────────────────────────────────────────────────────────

  async function handleBind(): Promise<void> {
    if (!tag || !holderId || !episode) return
    setBusy(true)
    try {
      const res = await bindFlag({
        rfidUid: tag.uid,
        holderId,
        orgId,
        episodeId: episode.id,
        passBookingId: bookingId || undefined,
        boundBy: staffUid,
        label: tag.known ? undefined : tag.label,
      })
      if (!res.ok) {
        toast.show({ title: 'Not bound', body: res.error, icon: 'circle-alert' })
        return
      }
      // Binding spends the Passage; it does not put anybody anywhere. The party
      // is standing in the Village of Queston from the moment they have a
      // standard, which is what puts them on Guests Afield before their first
      // station tap.
      //
      // Both options are load-bearing. The label, because the console is the
      // writer of record here and without it this gate leg pushes only the
      // holder's row and reads blank in the "standard" line and the CSV's flag
      // column. The questline, because otherwise the arrival derives one from
      // the ledger — the FIRST order the guest has a quest open on — and a Hero
      // party just rebound from one questline to another would go up on the
      // board under the quest they are no longer walking.
      // questTaken, because the Passage was just spent above: at the counter the
      // arrival and the taking-up are the same moment, and the day's log has to
      // be able to say when a party's quest began.
      checkInAtGate(holderId, Date.now(), {
        flagLabel: res.flag.label,
        orgId,
        questTaken: true,
      })
      // The park has to learn the binding, or the first plinth they reach holds
      // no row for the tag and correctly plays nothing.
      broadcastRow(res.flag.uid)
      toast.show({
        title: `${res.flag.label} bound`,
        body: `${groupName} — ${getOrg(orgId)?.name ?? ''}, Episode ${romanNumeral(episode.number)}.`,
        icon: 'flag',
      })
      reset()
    } finally {
      setBusy(false)
    }
  }

  async function handleComplete(): Promise<void> {
    if (!tag) return
    setBusy(true)
    try {
      const res = await completeFlag(tag.uid)
      if (!res.ok) {
        toast.show({ title: 'Not racked', body: res.error, icon: 'circle-alert' })
        return
      }
      broadcastRow(res.flag.uid)
      toast.show({
        title: `${res.flag.label} back on the rack`,
        body: `${res.flag.groupName ?? 'The party'} is off the board.`,
        icon: 'flag-off',
      })
      reset()
    } finally {
      setBusy(false)
    }
  }

  // ── The rack ──────────────────────────────────────────────────────────────

  const rack = flagStates()
  const out = rack.filter((s) => s.flag.status === 'bound' || s.flag.status === 'sealed')
  const overdue = rack.filter((s) => s.overdue)
  const openState = openPole ? rack.find((s) => s.flag.uid === openPole.uid) : undefined

  /**
   * Every rack action changes what the pole RESOLVES TO, so every one of them
   * bumps `tableAt` — and a bumped version that is never sent is the worst of
   * both worlds: the park is marked behind and nothing ever brings it forward.
   * The only other broadcaster is the hub-status guard, which fires when the hub
   * announces itself, so without this a released pole would go on playing the
   * old party's episode at all twenty-one plinths, and a retired or lost one
   * would resolve forever.
   */
  function withPole(uid: string, action: () => void, title: string): void {
    action()
    setOpenPole(null)
    broadcastRow(uid)
    refresh()
    toast.show({ title, icon: 'flag' })
  }

  // Completing from the rack Dialog takes the same route the pad does, so the
  // read-back is never skipped: it opens the completion stage rather than
  // racking the pole on the spot.
  const completingFlag = tag && stage === 'complete' ? flagByUid(tag.uid) : null

  return (
    <Card eyebrow="At the gate" title="The Ticket Booth" style={{ gridColumn: '1 / -1' }}>
      <div className="booth">
        <div>
          {stage === 'complete' ? (
            <>
              <div className="booth__stage booth__stage--complete">
                <Icon name="flag-off" size={18} />
                <span className="booth__stage-title">Complete the quest</span>
                <span className="booth__stage-note">The standard came back over the counter</span>
              </div>

              {completingFlag ? (
                <>
                  <div className="booth__readback booth__readback--complete">
                    <p>
                      <strong>{completingFlag.label}</strong> — {completingFlag.groupName ?? 'a party'},{' '}
                      {getOrg(completingFlag.orgId ?? '')?.name ?? 'no questline'}
                      {completingFlag.episodeNumber
                        ? `, Episode ${romanNumeral(completingFlag.episodeNumber)}`
                        : ''}
                      .{' '}
                      {completingFlag.boundAt
                        ? `Out ${outFor(Date.now() - completingFlag.boundAt)}.`
                        : ''}
                    </p>
                    <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                      Racking it takes the whole party off the board and marks the standard
                      returned. A pole that never came back stays out, and reads overdue.
                    </p>
                  </div>

                  <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                    <Button icon="flag-off" onClick={handleComplete} disabled={busy}>
                      {busy ? 'Racking…' : 'Rack the standard'}
                    </Button>
                    <Button variant="ghost" onClick={reset} disabled={busy}>
                      Not now
                    </Button>
                  </div>
                </>
              ) : (
                <p className="muted">That standard is no longer out with anybody.</p>
              )}
            </>
          ) : (
            <>
              <div className={`booth__stage booth__stage--${stage === 'bind' ? 'bind' : 'idle'}`}>
                <Icon name={stage === 'bind' ? 'flag' : 'scan-line'} size={18} />
                <span className="booth__stage-title">
                  {stage === 'bind' ? 'Bind a standard' : 'Waiting on a standard'}
                </span>
                <span className="booth__stage-note">
                  {stage === 'bind'
                    ? `${tag?.label ?? ''}${tag && !tag.known ? ' — new pole' : ''}`
                    : 'Tap a pole on the pad, or choose one from the rack'}
                </span>
              </div>

              <div onBlurCapture={recoverFocus}>
                <Input
                  id={CODE_FIELD_ID}
                  label="Invite code"
                  hint="Six letters or numbers"
                  icon="key-round"
                  value={code}
                  error={codeError}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABC123"
                  onChange={(e) => onCodeChange(e.target.value)}
                  onKeyDown={(e) => {
                    // A wedge scanner types whatever the label carries, Enter
                    // included, and that must not submit anything — it resolves
                    // the code instead.
                    //
                    // Tab is deliberately LEFT ALONE. Swallowing it would trap a
                    // Guide working the counter by keyboard, or with a screen
                    // reader, inside an always-focused field with the questline
                    // chips, the passages and the Bind button all below it and
                    // unreachable (WCAG 2.1.2). A scanner's Tab suffix is
                    // already harmless: `onCodeChange` drops every character
                    // that is not A-Z or 0-9, and `recoverFocus` pulls focus
                    // back only when it fell off the panel altogether.
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      resolveCode(code)
                    }
                  }}
                />
              </div>

              <div className="booth__section">
                <Input
                  label="Or find them by name"
                  icon="search"
                  value={nameQuery}
                  autoComplete="off"
                  placeholder="Start typing a name"
                  onChange={(e) => setNameQuery(e.target.value)}
                />
                {nameQuery.trim().length >= 2 ? (
                  <GuestResults
                    query={nameQuery}
                    onPick={(id) => {
                      setHolderId(id)
                      setNameQuery('')
                      setCode('')
                      setCodeError(undefined)
                    }}
                  />
                ) : null}
              </div>

              {holder ? (
                <>
                  <div className="booth__section">
                    <span className="booth__label">The party</span>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Icon name={party ? 'users' : 'user'} size={15} />
                      <strong style={{ color: 'var(--text-heading)' }}>{groupName}</strong>
                      <Badge tone="neutral">
                        {roster.length} {roster.length === 1 ? 'guest' : 'guests'}
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => setHolderId('')}>
                        Change
                      </Button>
                    </div>
                    <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      Recorded as {holder.name}.
                    </p>
                  </div>

                  <div className="booth__section">
                    <span className="booth__label">Questline</span>
                    <div className="booth__chips">
                      {ORGS.map((org) => (
                        <button
                          key={org.id}
                          type="button"
                          className="booth__chip"
                          aria-pressed={org.id === orgId}
                          style={{ ['--chip-track' as string]: org.color }}
                          onClick={() => {
                            setOrgChoice(org.id)
                            setEpisodeChoice('')
                          }}
                        >
                          <Icon name="scroll-text" size={13} />
                          {org.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="booth__section">
                    <Select
                      label="Episode"
                      hint="Their next unsealed"
                      value={episode?.id ?? ''}
                      options={episodeOptions}
                      error={
                        overridden
                          ? `The park walks and credits Episode ${romanNumeral(
                              derivedEpisode!.number
                            )} — no other can be bound.`
                          : undefined
                      }
                      onChange={(e) => setEpisodeChoice(e.target.value)}
                    />
                    {overridden ? (
                      <button
                        type="button"
                        className="booth__result"
                        style={{ marginTop: 8 }}
                        onClick={() => setEpisodeChoice('')}
                      >
                        <Icon name="undo-2" size={15} />
                        <span>Back to Episode {romanNumeral(derivedEpisode!.number)}</span>
                      </button>
                    ) : null}
                  </div>

                  <div className="booth__section">
                    <span className="booth__label">Passage</span>
                    {passages.length === 0 ? (
                      <p className="muted" style={{ fontSize: 13 }}>
                        Nobody in this party holds a passage. Sell one at the desk.
                      </p>
                    ) : (
                      passages.map((row) => {
                        const usable = row.state.status === 'valid'
                        return (
                          <button
                            key={`${row.memberId}:${row.state.booking.id}`}
                            type="button"
                            className="booth__pass"
                            aria-pressed={row.state.booking.id === bookingId}
                            disabled={!usable}
                            onClick={() => selectPassage(row)}
                          >
                            <Icon name="ticket-check" size={16} />
                            <span style={{ minWidth: 0 }}>
                              <span className="booth__pass-name">{row.state.tier.name}</span>
                              <span className="booth__pass-note" style={{ display: 'block' }}>
                                {row.memberName} · {row.state.booking.code} ·{' '}
                                {passStatusLabel(row.state.status)}
                              </span>
                              <span className="booth__pass-note" style={{ display: 'block' }}>
                                {row.state.note}
                              </span>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </>
              ) : (
                <p className="muted booth__section" style={{ fontSize: 13 }}>
                  Read the party&apos;s invite code, or find them by name.
                </p>
              )}

              {tag && holder && episode ? (
                <>
                  <div className="booth__readback">
                    <p>
                      <strong>{tag.label}</strong> to <strong>{groupName}</strong> —{' '}
                      {getOrg(orgId)?.name}, <strong>Episode {romanNumeral(episode.number)}</strong>{' '}
                      &ldquo;{episode.title}&rdquo;
                      {selectedPassage
                        ? `, on ${selectedPassage.state.tier.name} ${selectedPassage.state.booking.code}`
                        : alreadyPaid
                          ? ', already paid for'
                          : ''}
                      .
                    </p>
                    {!selectedPassage && !alreadyPaid ? (
                      <p className="booth__pass-note" style={{ marginTop: 8 }}>
                        No passage chosen — the binding will be refused unless this episode is
                        already paid for.
                      </p>
                    ) : null}
                    {overridden ? (
                      <p className="row booth__pass-note" style={{ gap: 6, marginTop: 8 }}>
                        <Icon name="triangle-alert" size={13} />
                        Choose their own episode before binding.
                      </p>
                    ) : null}
                  </div>

                  <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                    <Button icon="flag" onClick={handleBind} disabled={busy || overridden}>
                      {busy ? 'Binding…' : `Bind ${tag.label}`}
                    </Button>
                    <Button variant="ghost" onClick={reset} disabled={busy}>
                      Clear
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>

        {/* ── The rack ──────────────────────────────────────────────────── */}
        <div>
          <span className="booth__label">The rack</span>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
            {rack.length} poles · {out.length} out
            {overdue.length > 0 ? ` · ${overdue.length} overdue` : ''}
          </p>
          {rack.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No poles enrolled. Tap a new tag on the pad to put one on the rack.
            </p>
          ) : (
            <div className="booth__rack">
              {rack.map((s) => (
                <button
                  key={s.flag.uid}
                  type="button"
                  className={poleClass(s)}
                  title={s.note}
                  aria-label={`${s.flag.label} — ${s.note}`}
                  onClick={() => setOpenPole(s.flag)}
                >
                  <Icon name={poleGlyph(s.flag)} size={18} />
                  <span className="booth__pole-label">{s.flag.label}</span>
                  <span className="booth__pole-note">{s.flag.groupName ?? s.note}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {openPole && openState ? (
        <Dialog
          eyebrow="On the rack"
          title={openPole.label}
          onClose={() => setOpenPole(null)}
          footer={
            <Button variant="ghost" onClick={() => setOpenPole(null)}>
              Close
            </Button>
          }
        >
          <p style={{ marginTop: 0 }}>{openState.note}</p>
          {openPole.lastPlaceId ? (
            <p className="muted row" style={{ gap: 6, fontSize: 13 }}>
              <Icon name="map-pin" size={13} />
              Last seen at {openPole.lastPlaceId}
            </p>
          ) : null}

          <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            {openPole.status === 'bound' || openPole.status === 'sealed' ? (
              <Button
                icon="flag-off"
                onClick={() => {
                  const uid = openPole.uid
                  setOpenPole(null)
                  presentTag(uid)
                }}
              >
                Complete the quest
              </Button>
            ) : openPole.status === 'racked' ? (
              <Button
                icon="flag"
                onClick={() => {
                  const uid = openPole.uid
                  setOpenPole(null)
                  presentTag(uid)
                }}
              >
                Bind this standard
              </Button>
            ) : null}

            {openPole.status === 'bound' || openPole.status === 'sealed' ? (
              <Button
                variant="ghost"
                icon="undo-2"
                onClick={() => {
                  const uid = openPole.uid
                  setOpenPole(null)
                  void releaseFlag(uid).then(() => {
                    // The pole now resolves to nobody. Tell the park, or every
                    // station keeps playing the released party's episode for it.
                    broadcastRow(uid)
                    refresh()
                    toast.show({ title: 'Binding taken back', icon: 'undo-2' })
                  })
                }}
              >
                Release the binding
              </Button>
            ) : null}

            {openPole.status === 'lost' ? (
              <Button
                variant="secondary"
                icon="search-check"
                onClick={() => withPole(openPole.uid, () => markFound(openPole.uid), `${openPole.label} found`)}
              >
                Mark found
              </Button>
            ) : (
              <Button
                variant="ghost"
                icon="triangle-alert"
                onClick={() => withPole(openPole.uid, () => markLost(openPole.uid), `${openPole.label} marked lost`)}
              >
                Mark lost
              </Button>
            )}

            {openPole.status !== 'retired' ? (
              <Button
                variant="ghost"
                icon="flag-off"
                style={{ color: 'var(--status-danger)' }}
                onClick={() => withPole(openPole.uid, () => retireFlag(openPole.uid), `${openPole.label} retired`)}
              >
                Retire
              </Button>
            ) : null}
          </div>

          <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
            Release is an administrative undo — the binding should never have existed. Completing
            keeps the record of who walked and closes their day.
          </p>
        </Dialog>
      ) : null}
    </Card>
  )
}

/** Name search over the live guest directory the console already keeps warm. */
function GuestResults({ query, onPick }: { query: string; onPick: (id: string) => void }) {
  const needle = query.trim().toLowerCase()
  const hits = listDirectory()
    .filter((g) => g.name.toLowerCase().includes(needle))
    .slice(0, 12)

  if (hits.length === 0) {
    return (
      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        Nobody by that name is on the roll.
      </p>
    )
  }

  return (
    <div className="booth__results">
      {hits.map((g) => (
        <button key={g.id} type="button" className="booth__result" onClick={() => onPick(g.id)}>
          <Icon name="user" size={15} />
          <span style={{ minWidth: 0 }}>
            <span style={{ color: 'var(--text-heading)' }}>{g.name}</span>
            {g.partyName ? (
              <span className="booth__pass-note" style={{ display: 'block' }}>
                {g.partyName}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  )
}
