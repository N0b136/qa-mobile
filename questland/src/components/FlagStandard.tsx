// Your standard — the pole a party carries through the park.
//
// A Guide at the ticket booth binds a physical flagpole to a party, a questline
// and one episode, and hands it over; every plinth in the woods answers that
// pole and nothing else. None of that happens on the phone, so this is the only
// place a guest ever learns which standard is theirs, what it is bound to, and —
// the part that costs them a walk if they miss it — when it has stopped being
// current and has to go back to the booth.
//
// `flagService.flagForUser` finds the pole (party binding first, solo second);
// nothing here re-derives that. Three faces:
//
//   unbound — no pole, or the one they had is back on the rack. Dashed hairline,
//             the arch kept, `--status-locked` text: a locked state in this brand
//             is a shape you can still read, never a faded one.
//   bound   — the label, large, in the metal. The one fact they need when an
//             employee at the counter asks which standard is theirs.
//   stale   — the episode on the pole is not the episode they are walking. Ember,
//             because a stale standard is a NOW problem: until it is rebound the
//             readers have nothing current to play them.
//
// ABSENCE IS NOT AN ERROR. A guest on a local-only fallback account subscribes to
// no Firestore collection at all, so their phone never hears about a pole that
// exists perfectly well on the rack. The unbound face is written to be true
// either way — it points at the booth, which is where the answer is in both
// cases.

import type { CSSProperties } from 'react'
import { useAppTick } from '../hooks/useAppTick'
import { flagForUser } from '../services/flagService'
import { getProgress } from '../services/progressService'
import { getOrg } from '../content/orgs'
import { Badge, Card, Icon } from '../ui'
import { romanNumeral } from '../screens/questIcons'

interface Props {
  userId: string
  /**
   * `card` is the object itself, arch-topped, for a screen where the standard is
   * the subject. `inline` is one gold line for another screen's header, and it
   * renders NOTHING when there is no pole — see below.
   */
  variant?: 'card' | 'inline'
  /**
   * The questline the surrounding screen is about, when it has one.
   *
   * CheckInScreen is routed per order and a Hero Pass keeps all three open at
   * once, so the pole in a guest's hand is not necessarily bound to the quest
   * they are reading about. Given this, the standard says so; without it it
   * stays quiet, which is right on a screen that belongs to no single order.
   */
  orgId?: string
  style?: CSSProperties
}

const muted: CSSProperties = { font: 'var(--body-sm)', color: 'var(--text-muted)' }

/**
 * The party invite code's treatment, deliberately — both are a short string a
 * guest reads aloud to somebody else, and they should look like the same kind of
 * fact. See PartyScreen.
 */
const labelType: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 24,
  letterSpacing: '0.12em',
  color: 'var(--text-gold)',
}

/** The gate silhouette, kept in every face — including the locked one. */
const archCard: CSSProperties = { borderRadius: 'var(--radius-arch)', textAlign: 'center' }

/**
 * The arch curves down to meet the side walls, so content at the padding edge
 * would otherwise sit under it. Everything inside is centred for the same
 * reason: a standard is a ceremonial object, and centring it under the arch is
 * also what keeps it clear of the curve.
 */
const underArch: CSSProperties = { paddingTop: 16 }

export default function FlagStandard({ userId, variant = 'card', orgId, style }: Props) {
  useAppTick()

  const flag = flagForUser(userId)

  // STATUS, not membership. `completeFlag` racks a pole and deliberately KEEPS
  // its roster — that record is what says who walked today — so a guest who
  // handed their standard back at four o'clock is still in `memberIds` at six.
  // flagForUser already applies this test; it is repeated because it is the one
  // that matters and it costs a line.
  const held = flag && (flag.status === 'bound' || flag.status === 'sealed') ? flag : null

  if (!held) {
    // An inline mount lives inside another screen's header, where it must never
    // become the loudest thing. A guest walking an episode without a pole is
    // walking it legitimately — the in-app check-in is not going anywhere — so a
    // standing "you have no standard" line there would be nagging, not
    // information. The prompt belongs where arrival and party kit are the
    // subject, which is exactly where the card mounts.
    if (variant === 'inline') return null
    return (
      <Card style={{ ...archCard, borderStyle: 'dashed', boxShadow: 'none', ...style }}>
        <div style={underArch}>
          <Icon
            name="flag-triangle-right"
            size={22}
            style={{ margin: '0 auto', color: 'var(--status-locked)' }}
          />
          <div className="qa-label" style={{ marginTop: 8, color: 'var(--status-locked)' }}>
            Your standard
          </div>
          <div
            style={{
              marginTop: 6,
              font: '700 var(--text-lg)/1.1 var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-display-tight)',
              color: 'var(--status-locked)',
            }}
          >
            Not yet in hand
          </div>
          <p style={{ marginTop: 8, ...muted }}>
            Collect your standard at the ticket booth. One standard to a party, and the Guides bind
            it to your quest as they hand it over.
          </p>
        </div>
      </Card>
    )
  }

  // Sealed says it outright — the readers themselves stamped the pole. The
  // episode test catches the quieter case: the party sealed on foot through the
  // in-app check-in, which never touches the rack, so the pole still names a
  // walk that is over.
  //
  // WHOSE PROGRESS DECIDES IT: THE HOLDER'S, never the reader's. A party
  // legitimately sits on different episodes of one questline — `creditStation`
  // credits every member their OWN current episode, and `bindFlag` covers a mate
  // at `currentEpisode(mate, org)` for exactly that reason — so a mate who joined
  // at episode one, walking under a pole bound at episode seven, would read a
  // perfectly good binding as drifted and be sent back to a booth that cannot
  // help them: one standard binds one episode.
  //
  // And it asks whether the bound episode has been WALKED, not whether it is the
  // next one up. Completion is monotonic and union-merged, so this cannot flicker
  // as snapshots land, and a questline finished to its end contains the bound
  // episode too — stale for the same reason. Progress that has not reached this
  // phone reads as "not walked yet", so an unsynced mirror stays quiet instead of
  // raising a false alarm; the loud case, a pole the readers have already sealed,
  // arrives on the record itself as `status === 'sealed'`.
  const walkedBy = held.holderId ?? userId
  const drifted =
    !!held.orgId &&
    !!held.episodeId &&
    (getProgress(walkedBy)[held.orgId] ?? []).includes(held.episodeId)
  const stale = held.status === 'sealed' || drifted

  const org = held.orgId ? getOrg(held.orgId) : undefined
  const episodeName = held.episodeNumber ? `Episode ${romanNumeral(held.episodeNumber)}` : undefined
  // The pole is bound to a quest other than the one this screen is about. Not a
  // fault and not a now-state — the binding is sound, it simply belongs to a
  // different questline — so it is said in words rather than worn as a Badge.
  const elsewhere = !!orgId && !!held.orgId && held.orgId !== orgId
  const meta = [held.groupName, org?.name, episodeName].filter(Boolean).join(' · ')

  // Both notes can be true at once and neither replaces the other: a pole can be
  // stale AND still waiting for its tag.
  const notes: Array<{ icon: string; text: string }> = []
  if (stale) {
    notes.push({
      icon: 'rotate-ccw',
      text: episodeName
        ? `This standard still carries ${episodeName}. Carry it back to the booth and the Guides will bind your next quest to it.`
        : 'This standard has walked its episode. Carry it back to the booth and the Guides will bind your next quest to it.',
    })
  }
  if (held.tagPending) {
    // Said plainly and without alarm: a pole waiting for its tag is the ordinary
    // state of a rack before opening day, not a fault, and the walk is recorded
    // exactly as it always was. Never tell a guest to touch a marker that cannot
    // answer them.
    notes.push({
      icon: 'nfc',
      text: 'No tag is set in its tip yet, so the station markers will not answer it. Check in from your phone as you walk and your quest is recorded just the same.',
    })
  }
  if (notes.length === 0) {
    notes.push({
      icon: 'scan-line',
      text: 'Touch it to the marker at each station and the quest plays for your whole party.',
    })
  }

  if (variant === 'inline') {
    return (
      <div className="stack" style={{ gap: 6, ...style }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="row" style={{ gap: 6, color: 'var(--text-gold)' }}>
            <Icon name="flag-triangle-right" size={15} />
            <span style={{ ...labelType, fontSize: 15 }}>{held.label}</span>
          </span>
          {stale ? (
            <Badge tone="forge" icon="rotate-ccw">
              Return to the booth
            </Badge>
          ) : null}
          {held.tagPending ? <Badge icon="nfc">No tag yet</Badge> : null}
        </div>
        {/* The label alone would read as if the pole belonged to whatever quest
            the screen around it is about, and that is the one mistake here that
            costs a walk: the markers resolve the POLE'S order and episode, so a
            guest touching it at a station of another questline hears the quest
            it is bound to. The card carries this in its meta line; inline, on the
            one screen scoped to a single order, it has to be said. */}
        {elsewhere ? (
          <p style={muted}>
            {`Bound to ${[org?.name, episodeName].filter(Boolean).join(', ') || 'another quest'} — the markers will play that quest, not this one. The Guides will bind it to this questline back at the booth.`}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <Card style={{ ...archCard, ...style }}>
      <div style={underArch}>
        <div className="qa-label">Your standard</div>
        <div style={{ ...labelType, marginTop: 6 }}>{held.label}</div>
        {meta ? <p style={{ marginTop: 6, ...muted }}>{meta}</p> : null}
        {stale ? (
          <Badge tone="forge" icon="rotate-ccw" style={{ marginTop: 12 }}>
            Return to the booth
          </Badge>
        ) : null}
        {/* The label above is centred under the arch; a sentence is not, because
            a sentence is read rather than looked at. */}
        <div className="stack" style={{ gap: 6, marginTop: 12, textAlign: 'left' }}>
          {notes.map((note) => (
            <p key={note.icon} className="row" style={{ gap: 6, alignItems: 'flex-start', ...muted }}>
              <Icon name={note.icon} size={14} style={{ marginTop: 2 }} />
              <span style={{ flex: 1 }}>{note.text}</span>
            </p>
          ))}
        </div>
      </div>
    </Card>
  )
}
