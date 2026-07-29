// A notice off the board, as the guest reads it under "Happenings".
//
// Parchment, because a notice IS a document — the design system reserves vellum
// for tickets, maps and scrolls, and a proclamation nailed up in the village
// square is the same kind of thing. The hero feathers into the sheet rather than
// sitting square on it (Card's `imageFeather`), then the title, then a few lines
// of the notice, then "…see more" for the whole of it.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Announcement } from '../types'
import { Card, Dialog } from '../ui'

interface Props {
  notice: Announcement
  /** Preview mode for the console: renders the card, never opens the dialog. */
  readOnly?: boolean
}

/** Three lines of teaser, then the ellipsis takes over. */
const blurbStyle: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  margin: 0,
}

const seeMoreStyle: CSSProperties = {
  appearance: 'none',
  background: 'none',
  border: 0,
  padding: 0,
  marginTop: 'var(--space-sm)',
  font: '400 var(--text-sm)/1.2 var(--font-scribe)',
  color: 'var(--text-on-vellum)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  cursor: 'pointer',
}

/** 'Festival ✦ 24 Jul' — the meta rule along the foot of the sheet. */
function postedOn(at: number): string {
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'long' })
}

/** Blank lines are paragraph breaks; a notice is written, not marked up. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export default function AnnouncementCard({ notice, readOnly = false }: Props) {
  const [open, setOpen] = useState(false)
  const hasMore = notice.body.trim().length > 0

  return (
    <>
      <Card
        tone="parchment"
        tear={notice.tear ?? 'rough'}
        image={notice.image}
        imageAlt={notice.imageAlt ?? ''}
        imageFeather
        imageHeight={168}
        eyebrow={notice.eyebrow}
        title={notice.title}
        meta={postedOn(notice.publishAt)}
      >
        <p style={blurbStyle}>{notice.blurb}</p>
        {hasMore && !readOnly ? (
          <button type="button" style={seeMoreStyle} onClick={() => setOpen(true)}>
            …see more
          </button>
        ) : null}
      </Card>

      {open ? (
        <Dialog
          eyebrow={notice.eyebrow ?? 'Notice'}
          title={notice.title}
          onClose={() => setOpen(false)}
        >
          {/* The post scrolls inside the dialog rather than growing it. A long
              notice would otherwise stretch the box past the viewport and push
              its own close button up under the TopBar, which outranks a dialog
              nested in the Outlet's stacking context (see the Shell notes). */}
          <div style={{ maxHeight: '52dvh', overflowY: 'auto' }}>
          {notice.image ? (
            <img
              src={notice.image}
              alt={notice.imageAlt ?? ''}
              style={{
                width: '100%',
                maxHeight: 220,
                objectFit: 'cover',
                display: 'block',
                borderRadius: 'var(--radius-xs)',
                marginBottom: 'var(--space-lg)',
              }}
            />
          ) : null}
          {paragraphs(notice.body).map((p, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : 'var(--space-md) 0 0' }}>
              {p}
            </p>
          ))}
          </div>
          <div
            className="qa-label"
            style={{ marginTop: 'var(--space-lg)', color: 'var(--text-muted)' }}
          >
            Posted {postedOn(notice.publishAt)}
            {notice.createdBy ? ` · ${notice.createdBy}` : ''}
          </div>
        </Dialog>
      ) : null}
    </>
  )
}
