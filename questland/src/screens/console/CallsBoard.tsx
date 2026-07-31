import { useEffect, useState } from 'react'
import type { StaffPersona } from '../../content/staff'
import type { SosRequest } from '../../types'
import { listSos, acknowledgeSos, resolveSos } from '../../services/sosService'
import { hasUnread } from '../../services/sosChatService'
import { currentStaff, sosMeta } from '../../services/consoleService'
import { enablePush, pushState } from '../../services/pushService'
import { getZone } from '../../content/zones'
import ChatThread from '../../components/ChatThread'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, Icon } from '../../ui'

interface Props {
  persona: StaffPersona
}

function isToday(ms: number): boolean {
  const d = new Date(ms)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * Turns on lock-screen alerts for THIS desk.
 *
 * A console left on a back-office monitor nobody is watching is the failure mode
 * that makes a chat lane worse than no chat lane — the guest is told a Warden
 * will answer, and the tab is behind four others. With this on, a question buzzes
 * whoever is carrying the tablet.
 */
function DeskAlerts() {
  const [state, setState] = useState(() => pushState())
  if (state === 'on' || state === 'unconfigured' || state === 'unsupported') return null

  return (
    <div
      className="row row--between"
      style={{
        gap: 10,
        marginBottom: 14,
        padding: '8px 10px',
        border: '1px dashed var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <span className="muted" style={{ fontSize: 13 }}>
        {state === 'blocked'
          ? 'Alerts are blocked for this site — this desk will only see calls while the console is on screen.'
          : 'Alert this desk when a call or a question comes in.'}
      </span>
      {state === 'blocked' ? null : (
        <Button
          size="sm"
          variant="secondary"
          icon="bell"
          onClick={() => {
            const staff = currentStaff()
            if (!staff) return
            void enablePush(staff.uid, { staff: true }).then(setState)
          }}
        >
          Turn on
        </Button>
      )}
    </div>
  )
}

function urgency(call: SosRequest): number {
  return call.kind === 'emergency' ? 0 : call.kind === 'quest-help' ? 1 : 2
}

export default function CallsBoard({ persona }: Props) {
  const toast = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [showResolved, setShowResolved] = useState(false)
  // Exactly one thread is subscribed at a time — see the note in ChatThread.
  const [openThread, setOpenThread] = useState<string | null>(null)

  // Display-only 1s tick so the elapsed timers advance. Writes nothing.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const meta = sosMeta()
  const all = listSos()
  // Kind outranks age, and nothing reorders that. A chat that has been waiting
  // an hour is still a question; an emergency raised ten seconds ago is a body
  // in the woods. Within a kind, longest-waiting first.
  const active = all
    .filter((c) => c.status === 'open' || c.status === 'acknowledged')
    .sort((a, b) => urgency(a) - urgency(b) || a.createdAt - b.createdAt)
  const resolvedToday = all
    .filter((c) => c.status === 'resolved' && isToday(c.updatedAt))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  function dispatch(call: SosRequest) {
    acknowledgeSos(call.id, persona.name)
    toast.show({ title: `${persona.name} is on the way`, icon: 'send' })
  }

  function resolve(call: SosRequest) {
    resolveSos(call.id)
    toast.show({ title: 'Call for aid resolved', icon: 'check' })
  }

  function renderRow(call: SosRequest, i: number, resolved = false) {
    const guest = meta[call.id]?.guestName ?? 'A traveller'
    const zoneName = meta[call.id]?.zoneName ?? (call.zoneId ? getZone(call.zoneId)?.name : undefined)
    const emergency = call.kind === 'emergency'
    const chat = call.kind === 'chat'
    // Read off the parent call's stamps, NOT off the message mirror. The mirror
    // is filled by the thread listener, which runs only while a thread is open —
    // so a count taken here is structurally zero for every thread the Warden has
    // not already got on screen, which is precisely when the badge matters.
    const unread = hasUnread(call, 'warden')
    const threadOpen = openThread === call.id
    return (
      <div
        key={call.id}
        style={{
          padding: '14px 0',
          borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
          opacity: resolved ? 0.7 : 1,
        }}
      >
        <div className="row row--between" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--text-heading)' }}>{guest}</strong>
            <Badge
              tone={emergency ? 'valor' : 'gold'}
              icon={emergency ? 'shield' : chat ? 'message-circle' : 'life-buoy'}
            >
              {emergency ? 'Emergency' : chat ? 'Question' : 'Quest help'}
            </Badge>
            {unread ? (
              <Badge tone="valor" icon="message-circle">
                New word
              </Badge>
            ) : null}
          </div>
          <span
            className="muted row"
            style={{ gap: 5, fontSize: 12, whiteSpace: 'nowrap' }}
            title="Time since the call was raised"
          >
            <Icon name="timer" size={13} />
            {formatElapsed(now - call.createdAt)}
          </span>
        </div>

        {call.status === 'acknowledged' && call.responder ? (
          <div className="muted row" style={{ gap: 6, marginTop: 6, fontSize: 13 }}>
            <Icon name="check" size={14} />
            {call.responder} responding
          </div>
        ) : null}

        {zoneName ? (
          <div className="muted row" style={{ gap: 6, marginTop: 6, fontSize: 13 }}>
            <Icon name="map-pin" size={14} />
            {zoneName}
          </div>
        ) : null}

        {call.message ? (
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            &ldquo;{call.message}&rdquo;
          </p>
        ) : null}

        {/*
          The board's summary of the thread, read off the parent call's stamps.
          It is here so a Warden can triage twenty calls WITHOUT opening twenty
          threads — opening one is what starts paying for its messages.
        */}
        {call.lastMessagePreview ? (
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            <Icon
              name={call.lastMessageFrom === 'warden' ? 'corner-up-left' : 'message-circle'}
              size={14}
              style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }}
            />
            {call.lastMessagePreview}
          </p>
        ) : null}

        {!resolved ? (
          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            {call.status === 'open' && !chat ? (
              <Button size="sm" icon="send" onClick={() => dispatch(call)}>
                Dispatch
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={threadOpen ? 'ghost' : 'secondary'}
              icon="message-circle"
              onClick={() => setOpenThread(threadOpen ? null : call.id)}
            >
              {threadOpen ? 'Close thread' : chat ? 'Answer' : 'Message'}
            </Button>
            <Button size="sm" variant="ghost" icon="check" onClick={() => resolve(call)}>
              Resolve
            </Button>
          </div>
        ) : null}

        {threadOpen ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-inset)',
            }}
          >
            <ChatThread
              sosId={call.id}
              viewer="warden"
              authorName={persona.name}
              readOnly={resolved}
              height={300}
              placeholder={`Answer ${guest}`}
              readFloor={call.lastMessageAt}
              onSent={() => {
                // The first reply IS the claim. A Warden who has started typing
                // has taken the call, and making them press Dispatch as well
                // just means two Wardens answer the same guest.
                if (call.status === 'open') acknowledgeSos(call.id, persona.name)
              }}
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Card eyebrow="Live" title="Calls for Aid">
      <DeskAlerts />
      {active.length === 0 ? (
        <p className="muted">All quiet — no travellers are calling for aid.</p>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {active.map((call, i) => renderRow(call, i))}
        </div>
      )}

      {resolvedToday.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Button
            variant="ghost"
            size="sm"
            icon={showResolved ? 'chevron-down' : 'chevron-right'}
            onClick={() => setShowResolved((v) => !v)}
          >
            Resolved today ({resolvedToday.length})
          </Button>
          {showResolved ? (
            <div className="stack" style={{ gap: 0, marginTop: 8 }}>
              {resolvedToday.map((call, i) => renderRow(call, i, true))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
