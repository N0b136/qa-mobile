// The Notice Board: where the day's proclamations are written.
//
// Whatever is posted here lands under "Happenings" on every phone as a
// parchment notice — hero across the top, title, a few lines, and "…see more"
// for the whole post. The preview beside the form is the guest's card itself,
// not an approximation of it, so what a Warden sees here is what the village
// square sees.
//
// The hero is downscaled and re-encoded before it is stored (see
// announcementService.prepareHeroImage) and rides inside the notice as a data
// URL. That is what lets a notice reach a phone with no file host in the way,
// and it is why the byte budget is enforced rather than suggested.

import { useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import type { StaffPersona } from '../../content/staff'
import type { Announcement } from '../../types'
import {
  boardOrder,
  createAnnouncement,
  listAnnouncements,
  prepareHeroImage,
  removeAnnouncement,
  updateAnnouncement,
} from '../../services/announcementService'
import { useToast } from '../../components/Toast'
import AnnouncementCard from '../../components/AnnouncementCard'
import { Badge, Button, Card, Dialog, Icon, Input, Switch } from '../../ui'

interface Props {
  persona: StaffPersona
}

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-label)',
  color: 'var(--text-gold)',
  font: 'var(--label-ui)',
}

/** Rotates the torn edge so a column of notices never looks stamped. */
const TEARS: Array<Announcement['tear']> = ['rough', 'a', 'b', 'c']

function nextTear(count: number): Announcement['tear'] {
  return TEARS[count % TEARS.length]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function kb(chars: number): string {
  // A data URL is base64, so the bytes it stands for are about three quarters
  // of its length — that is the number worth showing.
  return `${Math.round((chars * 0.75) / 1024)} KB`
}

interface Draft {
  eyebrow: string
  title: string
  blurb: string
  body: string
  image?: string
  imageAlt: string
  pinned: boolean
  publishLocal: string
  expires: boolean
  expiresLocal: string
}

function emptyDraft(): Draft {
  return {
    eyebrow: '',
    title: '',
    blurb: '',
    body: '',
    imageAlt: '',
    pinned: false,
    publishLocal: toLocalInput(Date.now()),
    expires: false,
    expiresLocal: toLocalInput(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }
}

function draftFrom(a: Announcement): Draft {
  return {
    eyebrow: a.eyebrow ?? '',
    title: a.title,
    blurb: a.blurb,
    body: a.body,
    image: a.image,
    imageAlt: a.imageAlt ?? '',
    pinned: !!a.pinned,
    publishLocal: toLocalInput(a.publishAt),
    expires: a.expiresAt !== undefined,
    expiresLocal: toLocalInput(a.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000),
  }
}

/** The card the preview renders — a real Announcement built from the draft. */
function previewOf(draft: Draft, tear: Announcement['tear']): Announcement {
  const at = new Date(draft.publishLocal).getTime()
  return {
    id: 'preview',
    eyebrow: draft.eyebrow.trim() || undefined,
    title: draft.title.trim() || 'Your notice',
    blurb: draft.blurb.trim() || 'A line or two of what happened, or is about to.',
    body: draft.body,
    image: draft.image,
    imageAlt: draft.imageAlt,
    tear,
    status: 'published',
    publishAt: Number.isFinite(at) ? at : Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export default function NoticeBoard({ persona }: Props) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmStrike, setConfirmStrike] = useState<Announcement | null>(null)

  const board = boardOrder(listAnnouncements())
  const editing = editingId ? board.find((a) => a.id === editingId) : undefined
  const tear = editing?.tear ?? nextTear(board.length)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function takeFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    const result = await prepareHeroImage(file)
    setBusy(false)
    if (!result.ok) {
      toast.show({ title: result.error, icon: 'triangle-alert' })
      return
    }
    setDraft((d) => ({ ...d, image: result.dataUrl }))
    toast.show({ title: `Hero set · ${kb(result.chars)}`, icon: 'image' })
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    void takeFile(e.dataTransfer.files?.[0])
  }

  function reset() {
    setDraft(emptyDraft())
    setEditingId(null)
  }

  function handlePost(status: Announcement['status']) {
    if (!draft.title.trim() || !draft.blurb.trim()) {
      toast.show({ title: 'A notice needs a title and a blurb', icon: 'triangle-alert' })
      return
    }
    const publishAt = new Date(draft.publishLocal).getTime()
    if (!Number.isFinite(publishAt)) {
      toast.show({ title: 'Choose a valid posting time', icon: 'triangle-alert' })
      return
    }
    const expiresAt = draft.expires ? new Date(draft.expiresLocal).getTime() : undefined
    if (draft.expires && (!Number.isFinite(expiresAt as number) || (expiresAt as number) <= publishAt)) {
      toast.show({ title: 'It must come down after it goes up', icon: 'triangle-alert' })
      return
    }

    const shared = {
      eyebrow: draft.eyebrow,
      title: draft.title,
      blurb: draft.blurb,
      body: draft.body,
      imageAlt: draft.imageAlt,
      pinned: draft.pinned,
      status,
      publishAt,
      createdBy: persona.name,
    }

    if (editingId) {
      updateAnnouncement(editingId, {
        ...shared,
        // null strikes the field. Without it, a hero the Warden just removed —
        // or a take-down date they just switched off — would quietly stand.
        image: draft.image ?? null,
        expiresAt: expiresAt ?? null,
      })
      toast.show({ title: 'Notice revised', icon: 'pen-line' })
    } else {
      createAnnouncement({ ...shared, image: draft.image, expiresAt, tear })
      toast.show({
        title: status === 'published' ? 'Notice posted to the board' : 'Draft kept',
        icon: 'scroll-text',
      })
    }
    reset()
  }

  return (
    <Card eyebrow="Proclamations" title="Notice Board" style={{ gridColumn: '1 / -1' }}>
      <div className="notice-board">
        {/* ── The writing side ─────────────────────────────────────────── */}
        <div className="stack" style={{ gap: 16 }}>
          {editing ? (
            <div className="row row--between" style={{ gap: 8 }}>
              <Badge tone="live" dot>
                Revising “{editing.title}”
              </Badge>
              <Button size="sm" variant="ghost" icon="x" onClick={reset}>
                New notice
              </Button>
            </div>
          ) : null}

          <div>
            <div style={{ ...capsHeadingStyle, marginBottom: 8 }}>Hero image</div>
            <div
              className={`notice-drop${dragOver ? ' notice-drop--over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
              }}
              aria-label="Drop a hero image, or choose a file"
            >
              {draft.image ? (
                <img src={draft.image} alt="" className="notice-drop__shot" />
              ) : (
                <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-gold)' }}>
                    <Icon name="image-plus" size={26} />
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {busy ? 'Preparing…' : 'Drop an image, or click to choose'}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Shrunk and re-encoded here — its edges feather into the parchment
                  </span>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void takeFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {draft.image ? (
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <Button size="sm" variant="secondary" icon="replace" onClick={() => fileRef.current?.click()}>
                  Replace
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash-2"
                  onClick={() => setDraft((d) => ({ ...d, image: undefined }))}
                >
                  Remove
                </Button>
              </div>
            ) : null}
          </div>

          {draft.image ? (
            <Input
              label="Image description"
              hint="For guests using a screen reader"
              value={draft.imageAlt}
              onChange={(e) => set('imageAlt', e.target.value)}
              placeholder="Lanterns rising over the lake at dusk"
            />
          ) : null}

          <Input
            label="Eyebrow"
            hint="Optional"
            value={draft.eyebrow}
            onChange={(e) => set('eyebrow', e.target.value)}
            placeholder="Festival"
          />
          <Input
            label="Title"
            required
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="The Lantern Rite returns"
          />
          <Input
            label="Blurb"
            required
            hint="Three lines on the card"
            multiline
            rows={2}
            value={draft.blurb}
            onChange={(e) => set('blurb', e.target.value)}
            placeholder="What it is, in a breath."
          />
          <Input
            label="The whole notice"
            hint="Opens on “…see more”. Blank lines split paragraphs."
            multiline
            rows={7}
            value={draft.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder="The full telling — what happens, when, where to stand, and who to ask."
          />

          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <Switch
              label="Pin to the top"
              checked={draft.pinned}
              onChange={(e) => set('pinned', e.target.checked)}
            />
            <Switch
              label="Take it down later"
              checked={draft.expires}
              onChange={(e) => set('expires', e.target.checked)}
            />
          </div>

          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input
              label="Goes up"
              type="datetime-local"
              value={draft.publishLocal}
              onChange={(e) => set('publishLocal', e.target.value)}
              style={{ flex: '1 1 200px' }}
            />
            {draft.expires ? (
              <Input
                label="Comes down"
                type="datetime-local"
                value={draft.expiresLocal}
                min={draft.publishLocal}
                onChange={(e) => set('expiresLocal', e.target.value)}
                style={{ flex: '1 1 200px' }}
              />
            ) : null}
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button icon="scroll-text" onClick={() => handlePost('published')}>
              {editingId ? 'Save notice' : 'Post to the board'}
            </Button>
            <Button variant="secondary" icon="file-pen" onClick={() => handlePost('draft')}>
              Keep as draft
            </Button>
          </div>
        </div>

        {/* ── What the village square sees ─────────────────────────────── */}
        <div>
          <div style={{ ...capsHeadingStyle, marginBottom: 8 }}>As guests will read it</div>
          <div className="notice-preview">
            <AnnouncementCard notice={previewOf(draft, tear)} readOnly />
          </div>

          <div style={{ ...capsHeadingStyle, margin: '20px 0 8px' }}>
            On the board ({board.length})
          </div>
          {board.length === 0 ? (
            <p className="muted">Nothing is posted. Write the first notice.</p>
          ) : (
            <div className="stack" style={{ gap: 0 }}>
              {board.map((a, i) => {
                const now = Date.now()
                const gone = a.expiresAt !== undefined && a.expiresAt <= now
                const waiting = a.status === 'published' && a.publishAt > now
                return (
                  <div
                    key={a.id}
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
                        <strong style={{ color: 'var(--text-heading)' }}>{a.title}</strong>
                        {a.pinned ? <Badge>Pinned</Badge> : null}
                        {a.status === 'draft' ? <Badge>Draft</Badge> : null}
                        {waiting ? <Badge>Queued</Badge> : null}
                        {gone ? <Badge>Down</Badge> : null}
                      </div>
                      <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                        {new Date(a.publishAt).toLocaleString()}
                        {a.createdBy ? ` · ${a.createdBy}` : ''}
                        {a.image ? ' · hero' : ''}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="pen-line"
                        onClick={() => {
                          setEditingId(a.id)
                          setDraft(draftFrom(a))
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash-2"
                        onClick={() => setConfirmStrike(a)}
                      >
                        Strike
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {confirmStrike ? (
        <Dialog
          eyebrow="Take it down"
          title="Strike this notice?"
          onClose={() => setConfirmStrike(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmStrike(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                icon="trash-2"
                onClick={() => {
                  removeAnnouncement(confirmStrike.id)
                  if (editingId === confirmStrike.id) reset()
                  setConfirmStrike(null)
                  toast.show({ title: 'Notice struck', icon: 'trash-2' })
                }}
              >
                Strike it
              </Button>
            </>
          }
        >
          “{confirmStrike.title}” comes off every guest's board. This cannot be undone.
        </Dialog>
      ) : null}
    </Card>
  )
}
