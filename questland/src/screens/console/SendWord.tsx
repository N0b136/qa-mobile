import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { StaffPersona } from '../../content/staff'
import type { Audience } from '../../services/cloudSync'
import type { NotificationType } from '../../types'
import {
  sendWord,
  scheduleWord,
  cancelScheduled,
  listScheduled,
  listDirectory,
  recentSends,
} from '../../services/consoleService'
import { CONSOLE_TEMPLATES } from '../../content/consoleTemplates'
import { ORGS } from '../../content/orgs'
import { useToast } from '../../components/Toast'
import type { SelectOption } from '../../ui'
import { Badge, Button, Card, Icon, Input, Radio, Select, Tabs } from '../../ui'

interface Props {
  persona: StaffPersona
  prefillAudience: Audience | null
}

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-label)',
  color: 'var(--text-gold)',
  font: 'var(--label-ui)',
}

function audienceValue(a: Audience): string {
  return a.kind === 'all' ? 'all' : `${a.kind}:${a.id}`
}

function parseAudience(value: string): Audience {
  if (value === 'all') return { kind: 'all' }
  const idx = value.indexOf(':')
  const kind = value.slice(0, idx)
  const id = value.slice(idx + 1)
  if (kind === 'guest') return { kind: 'guest', id }
  if (kind === 'party') return { kind: 'party', id }
  if (kind === 'org') return { kind: 'org', id }
  return { kind: 'all' }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function countdown(deliverAt: number, now: number): string {
  const diff = deliverAt - now
  if (diff <= 0) return 'now'
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'in under a minute'
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  if (hrs < 24) return rem ? `in ${hrs}h ${rem}m` : `in ${hrs}h`
  const days = Math.round(hrs / 24)
  return `in ${days}d`
}

export default function SendWord({ persona, prefillAudience }: Props) {
  const toast = useToast()
  const [tab, setTab] = useState<'compose' | 'scheduled'>('compose')

  const [value, setValue] = useState('all')
  const [type, setType] = useState<NotificationType>('system')
  const [icon, setIcon] = useState<string | undefined>('bell')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [deliverLocal, setDeliverLocal] = useState(() => toLocalInput(Date.now() + 60 * 60 * 1000))
  const [now, setNow] = useState(() => Date.now())

  // 1s tick keeps the schedule countdowns live.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  // Prefill the audience when a roster row asks to send to a specific guest.
  useEffect(() => {
    if (prefillAudience) {
      setValue(audienceValue(prefillAudience))
      setTab('compose')
    }
  }, [prefillAudience])

  const directory = listDirectory()

  const options: SelectOption[] = [{ value: 'all', label: 'All guests' }]
  directory.forEach((g) => options.push({ value: `guest:${g.id}`, label: g.name }))
  const seenParty = new Set<string>()
  directory.forEach((g) => {
    if (g.partyId && g.partyName && !seenParty.has(g.partyId)) {
      seenParty.add(g.partyId)
      options.push({ value: `party:${g.partyId}`, label: `Party — ${g.partyName}` })
    }
  })
  ORGS.forEach((o) => options.push({ value: `org:${o.id}`, label: o.name }))

  const scheduled = listScheduled()
  const upcoming = scheduled
    .filter((s) => s.status === 'scheduled')
    .sort((a, b) => a.deliverAt - b.deliverAt)
  const history = scheduled
    .filter((s) => s.status === 'fired' || s.status === 'cancelled')
    .sort((a, b) => (b.firedAt ?? b.deliverAt) - (a.firedAt ?? a.deliverAt))
    .slice(0, 10)
  const sent = recentSends().slice(0, 5)

  function applyTemplate(t: (typeof CONSOLE_TEMPLATES)[number]) {
    setType(t.type)
    setIcon(t.icon)
    setTitle(t.title)
    setBody(t.body)
  }

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      toast.show({ title: 'Add a title and a message first', icon: 'triangle-alert' })
      return
    }
    const audience = parseAudience(value)
    const input = { type, title: title.trim(), body: body.trim(), icon }

    if (when === 'now') {
      const count = await sendWord(audience, input)
      // Sending to one party or one guest is the common case at a counter, and
      // "Word sent to 1 guests" is the receipt for it.
      toast.show({ title: `Word sent to ${count} ${count === 1 ? 'guest' : 'guests'}`, icon: 'send' })
      return
    }

    const deliverAt = new Date(deliverLocal).getTime()
    if (!Number.isFinite(deliverAt)) {
      toast.show({ title: 'Choose a valid delivery time', icon: 'triangle-alert' })
      return
    }
    scheduleWord(audience, input, deliverAt, persona.name)
    toast.show({ title: `Word scheduled for ${new Date(deliverAt).toLocaleString()}`, icon: 'clock' })
    setTab('scheduled')
  }

  return (
    <Card eyebrow="Broadcast" title="Send Word">
      <div style={{ marginTop: 4, marginBottom: 16 }}>
        <Tabs
          variant="segmented"
          value={tab}
          onChange={(id) => setTab(id as 'compose' | 'scheduled')}
          items={[
            { id: 'compose', label: 'Compose', icon: 'pen-line' },
            { id: 'scheduled', label: `Scheduled (${upcoming.length})`, icon: 'clock' },
          ]}
        />
      </div>

      {tab === 'compose' ? (
        <div className="stack" style={{ gap: 16 }}>
          <Select
            label="Audience"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            options={options}
          />

          <div>
            <div style={{ ...capsHeadingStyle, marginBottom: 8 }}>Templates</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {CONSOLE_TEMPLATES.map((t) => (
                <Button
                  key={t.id}
                  variant="secondary"
                  size="sm"
                  icon={t.icon}
                  onClick={() => applyTemplate(t)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>

          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A short herald"
          />
          <Input
            label="Message"
            multiline
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="The word travellers will read."
          />

          <div>
            <div style={{ ...capsHeadingStyle, marginBottom: 8 }}>Preview</div>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                padding: 14,
                background: 'var(--surface-inset)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow-carve-in)',
              }}
            >
              <span style={{ color: 'var(--text-gold)', flex: '0 0 auto', marginTop: 2 }}>
                <Icon name={icon || 'bell'} size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <strong style={{ color: 'var(--text-heading)' }}>{title || 'Your title'}</strong>
                <div className="muted" style={{ marginTop: 2, fontSize: 13 }}>
                  {body || 'Your message to travellers.'}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div style={{ ...capsHeadingStyle, marginBottom: 8 }}>When</div>
            <div className="row" style={{ gap: 20 }}>
              <Radio
                name="send-when"
                label="Now"
                checked={when === 'now'}
                onChange={() => setWhen('now')}
              />
              <Radio
                name="send-when"
                label="Later"
                checked={when === 'later'}
                onChange={() => setWhen('later')}
              />
            </div>
            {when === 'later' ? (
              <div style={{ marginTop: 12 }}>
                <Input
                  label="Deliver at"
                  type="datetime-local"
                  value={deliverLocal}
                  min={toLocalInput(Date.now())}
                  onChange={(e) => setDeliverLocal(e.target.value)}
                />
              </div>
            ) : null}
          </div>

          <Button icon="send" onClick={handleSend}>
            {when === 'now' ? 'Send word' : 'Schedule word'}
          </Button>

          {sent.length > 0 ? (
            <div>
              <div style={{ ...capsHeadingStyle, marginBottom: 8 }}>Recent broadcasts</div>
              <div className="stack" style={{ gap: 6 }}>
                {sent.map((s) => (
                  <div key={s.id} className="row row--between" style={{ gap: 8 }}>
                    <span className="muted" style={{ fontSize: 13, minWidth: 0 }}>
                      {s.title}
                    </span>
                    <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {s.audienceLabel} · {s.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {upcoming.length === 0 ? (
            <p className="muted">No word is queued. Compose one and choose Later to schedule it.</p>
          ) : (
            <div className="stack" style={{ gap: 0 }}>
              {upcoming.map((s, i) => {
                const overdue = s.deliverAt <= now
                return (
                  <div
                    key={s.id}
                    className="row row--between"
                    style={{
                      gap: 10,
                      padding: '12px 0',
                      alignItems: 'flex-start',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ color: 'var(--text-heading)' }}>{s.title}</strong>
                        {overdue ? <Badge tone="live" dot>Firing</Badge> : null}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                        {s.audienceLabel} · {new Date(s.deliverAt).toLocaleString()} · {countdown(s.deliverAt, now)}
                      </div>
                      <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>
                        by {s.createdBy}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="x"
                      onClick={() => cancelScheduled(s.id)}
                    >
                      Cancel
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {history.length > 0 ? (
            <div>
              <div style={{ ...capsHeadingStyle, marginBottom: 8 }}>History</div>
              <div className="stack" style={{ gap: 0 }}>
                {history.map((s, i) => (
                  <div
                    key={s.id}
                    className="row row--between"
                    style={{
                      gap: 10,
                      padding: '10px 0',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                    }}
                  >
                    <span className="muted" style={{ fontSize: 13, minWidth: 0 }}>
                      {s.title}
                    </span>
                    <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {s.status === 'fired' ? `Sent · ${s.count ?? 0}` : 'Cancelled'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}
