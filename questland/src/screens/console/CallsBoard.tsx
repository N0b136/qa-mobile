import { useEffect, useState } from 'react'
import type { StaffPersona } from '../../content/staff'
import type { SosRequest } from '../../types'
import { listSos, acknowledgeSos, resolveSos } from '../../services/sosService'
import { sosMeta } from '../../services/consoleService'
import { getZone } from '../../content/zones'
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

export default function CallsBoard({ persona }: Props) {
  const toast = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [showResolved, setShowResolved] = useState(false)

  // Display-only 1s tick so the elapsed timers advance. Writes nothing.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const meta = sosMeta()
  const all = listSos()
  const open = all.filter((c) => c.status === 'open')
  const acknowledged = all.filter((c) => c.status === 'acknowledged')
  const active = [...open, ...acknowledged]
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
            <Badge tone={emergency ? 'valor' : 'gold'} icon={emergency ? 'shield' : 'life-buoy'}>
              {emergency ? 'Emergency' : 'Quest help'}
            </Badge>
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

        {!resolved ? (
          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            {call.status === 'open' ? (
              <Button size="sm" icon="send" onClick={() => dispatch(call)}>
                Dispatch
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon="check" onClick={() => resolve(call)}>
              Resolve
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Card eyebrow="Live" title="Calls for Aid">
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
