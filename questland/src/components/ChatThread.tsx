import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SosMessage, SosMessageAuthor } from '../types'
import { useAppTick } from '../hooks/useAppTick'
import { listMessages, markThreadRead, retryMessage, sendMessage } from '../services/sosChatService'
import { stampLastMessage } from '../services/sosService'
import { subscribeSosThread } from '../services/cloudSync'
import { Button, Icon } from '../ui'

/**
 * One conversation, rendered the same on the guest's phone and on the console.
 *
 * Both sides run this component; `viewer` is the only thing that differs. That
 * is deliberate — a Warden reading a thread should be looking at what the guest
 * is looking at, not at an operator's transcript of it, or the two drift and
 * nobody can tell what the guest actually saw.
 */
export interface ChatThreadProps {
  sosId: string
  /** Which side this device is. Decides bubble alignment and what counts as unread. */
  viewer: SosMessageAuthor
  /** Name stamped onto lines sent from here — the Warden's persona, or the guest's name. */
  authorName: string
  /**
   * The signed-in STAFF uid, for the manager tally of who answered what.
   *
   * Console only. The guest passes nothing and must keep passing nothing: the
   * uid is what attributes a reply to a named employee, the rules refuse
   * `replyBy` to anyone off the staff roll, and the persona name above is a
   * costume — several Wardens can wear one. Passing it as a prop rather than
   * having sosService look it up keeps consoleService out of the guest bundle.
   */
  byUid?: string
  /** Closed threads keep their transcript and lose the composer. */
  readOnly?: boolean
  /** Scroll region height. The console has room; a phone does not. */
  height?: number
  placeholder?: string
  /** Fired after a line is written locally — the console claims the call on its first reply. */
  onSent?: (body: string) => void
  /**
   * The parent call's `lastMessageAt`. The board badges off that stamp, and it
   * is written a moment after the message it describes, so reading the thread
   * has to clear it too or the badge stays lit on a thread just read.
   */
  readFloor?: number
  /**
   * Whether this component attaches its own thread listener.
   *
   * TRUE on the console, where a Warden may have dozens of calls and only the
   * open one is worth listening to. FALSE on the guest, where `startGuestSync`
   * already holds a listener on every one of their own calls for the life of the
   * app — so a reply arrives wherever they are, and this screen only has to
   * render a mirror that is already current.
   */
  selfSubscribe?: boolean
}

const MAX_BODY = 2000

/**
 * True on a desk with a mouse, false on a touch screen. Read once at module
 * load: nobody grows a keyboard mid-thread, and re-evaluating it per render
 * would cost a media-query match on every incoming line.
 */
const finePointer =
  typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches

const scrollStyle: CSSProperties = {
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '2px 2px 6px',
}

export default function ChatThread({
  sosId,
  viewer,
  authorName,
  byUid,
  readOnly = false,
  height = 260,
  placeholder = 'Write to the Warden',
  onSent,
  readFloor,
  selfSubscribe = true,
}: ChatThreadProps) {
  useAppTick()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const messages = listMessages(sosId)

  // On the console the listener lives and dies with the thread being ON SCREEN.
  // That is the cost model: a listener per open thread is a handful of
  // documents, while a collectionGroup listener over every thread in the park
  // would charge every warden's screen for every message anybody sends, forever.
  // The guest opts out — startGuestSync holds their threads app-wide instead.
  useEffect(() => {
    if (!selfSubscribe) return
    return subscribeSosThread(sosId)
  }, [sosId, selfSubscribe])

  // Reading it is what marks it read — there is no separate "mark as read", and
  // an unread badge that outlives the thread being open is a badge people learn
  // to ignore.
  const lastAt = messages.length ? messages[messages.length - 1].createdAt : 0
  useEffect(() => {
    markThreadRead(sosId, viewer, readFloor)
  }, [sosId, viewer, readFloor, lastAt])

  // Pin to the newest line. Only when a line arrives, so a Warden scrolled up
  // reading history is not yanked back down mid-sentence by their own listener.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastAt])

  const canSend = draft.trim().length > 0 && draft.length <= MAX_BODY

  function send() {
    const body = draft.trim()
    if (!body || body.length > MAX_BODY) return
    const sent = sendMessage(sosId, { from: viewer, authorName, body })
    if (!sent) return
    // Summarize onto the parent so the console board can order and badge itself
    // without a listener on every thread. The same write carries the manager
    // counters, which is why they cost nothing: no second round trip, and the
    // figures come off documents the board already holds.
    stampLastMessage(sosId, viewer, body, byUid)
    setDraft('')
    onSent?.(body)
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div ref={scrollRef} style={{ ...scrollStyle, height }}>
        {messages.length === 0 ? (
          <p className="muted" style={{ margin: 'auto 0', textAlign: 'center', fontSize: 13 }}>
            {viewer === 'guest'
              ? 'No word yet. Ask your question and a Warden will answer here.'
              : 'Nothing said yet on this call.'}
          </p>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} viewer={viewer} />)
        )}
      </div>

      {readOnly ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          This thread is closed. The transcript stays here.
        </p>
      ) : (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
            placeholder={placeholder}
            rows={2}
            aria-label={placeholder}
            enterKeyHint="enter"
            onKeyDown={(e) => {
              // Enter sends ONLY where there is a physical keyboard.
              //
              // The touch keyboard's return key fires a real Enter keydown in a
              // textarea on both Android and iOS — it does not quietly insert a
              // newline, as this comment used to claim. Cancelling it there
              // leaves a guest with no way to break a line at all: they press
              // return to start a second sentence and the half-written question
              // goes to a Warden instead. The Send button is always visible, so
              // touch loses nothing by keeping its return key.
              if (finePointer && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            style={{
              flex: 1,
              resize: 'none',
              minHeight: 44,
              padding: '10px 12px',
              font: 'var(--body-base)',
              color: 'var(--text-body)',
              background: 'var(--surface-inset)',
              border: '1px solid var(--border-hairline)',
              // Match the DS field treatment (ui/Input): carved into the stone,
              // tight 2px radius. Every other field in the app reads that way.
              borderRadius: 'var(--radius-xs)',
              boxShadow: 'var(--shadow-carve-in)',
            }}
          />
          <Button icon="send" onClick={send} disabled={!canSend} aria-label="Send">
            Send
          </Button>
        </div>
      )}
    </div>
  )
}

function Bubble({ message, viewer }: { message: SosMessage; viewer: SosMessageAuthor }) {
  const mine = message.from === viewer
  const fromWarden = message.from === 'warden'

  const style: CSSProperties = useMemo(
    () => ({
      alignSelf: mine ? 'flex-end' : 'flex-start',
      maxWidth: '85%',
      padding: '8px 12px',
      borderRadius: 'var(--radius-md)',
      background: fromWarden ? 'var(--surface-card-raised)' : 'var(--surface-inset)',
      // Gold as a hairline is gold as metal — an edge, never a fill. It marks
      // the park's own voice so a guest can tell at a glance which lines are
      // the Warden's.
      border: fromWarden ? '1px solid var(--border-gold)' : '1px solid var(--border-hairline)',
      boxShadow: 'var(--shadow-xs)',
    }),
    [mine, fromWarden]
  )

  return (
    <div style={style}>
      <div
        style={{
          font: 'var(--label-ui)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-label)',
          color: fromWarden ? 'var(--text-gold)' : 'var(--text-muted)',
          marginBottom: 3,
        }}
      >
        {/*
          Coerced, not trusted. The rules now type-check both of these on the
          way in, but a line is WRITE-ONCE — nobody, staff included, can take a
          bad one back — and there is no ErrorBoundary in this app, so a single
          non-string that ever reached the collection would throw "Objects are
          not valid as a React child" and unmount the entire console, on every
          reload, forever. Two String() calls are a cheap second lock.
        */}
        {String(message.authorName ?? '')}
      </div>
      <div style={{ font: 'var(--body-base)', color: 'var(--text-body)', whiteSpace: 'pre-wrap' }}>
        {String(message.body ?? '')}
      </div>
      <Delivery message={message} mine={mine} />
    </div>
  )
}

/**
 * The honest bit.
 *
 * `delivery` is only ever set on messages THIS device sent, and only the server
 * clears it — so 'pending' is not a spinner, it is a statement that nobody has
 * received this yet. On a phone in a dead spot under the canopy that state can
 * last minutes, and saying so is the entire reason the field exists.
 */
function Delivery({ message, mine }: { message: SosMessage; mine: boolean }) {
  if (!mine || !message.delivery) return null

  if (message.delivery === 'sent') {
    return (
      <div className="row muted" style={{ gap: 4, marginTop: 4, fontSize: 11 }}>
        <Icon name="check" size={12} />
        Delivered
      </div>
    )
  }

  if (message.delivery === 'pending') {
    return (
      <div className="row muted" style={{ gap: 4, marginTop: 4, fontSize: 11 }}>
        <Icon name="clock" size={12} />
        Not sent yet — waiting for a signal
      </div>
    )
  }

  return (
    <div className="row" style={{ gap: 6, marginTop: 4, fontSize: 11, flexWrap: 'wrap' }}>
      <span className="row" style={{ gap: 4, color: 'var(--status-danger)' }}>
        <Icon name="triangle-alert" size={12} />
        Refused — not delivered
      </span>
      <Button
        size="sm"
        variant="ghost"
        icon="rotate-cw"
        onClick={() => retryMessage(message.sosId, message.id)}
      >
        Try again
      </Button>
    </div>
  )
}
