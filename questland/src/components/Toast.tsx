import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { uid } from '../services/ids'
import { Icon } from '../ui'

// Kebab-case Lucide glyph names only — legacy emoji strings from callers not
// yet migrated fall back to their raw literal so they keep rendering as-is
// (data-level emoji purge for those call sites is a separate later pass).
const LUCIDE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

interface ToastInput {
  title: string
  body?: string
  /** Lucide glyph name, e.g. "bell-off". */
  icon?: string
}

interface ToastItem extends ToastInput {
  id: string
  /** How long this one gets, decided from its own length when it is raised. */
  ms: number
}

interface ToastContextValue {
  show: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

// ── HOW LONG A TOAST LIVES, AND WHY IT IS NOT ONE NUMBER ─────────────────────
//
// It was one number — 3500ms for everything — and that number was set against
// "Word sent to 4 guests". The counter now raises messages that are three
// sentences of staff instruction: a refused enrolment, tag swap, release or
// completion tells the Guide the write did not land, why, and to sign in again
// before repeating it. The instruction is the LAST sentence, and a fixed 3.5s
// window destroyed it before it could be read, let alone acted on.
//
// So a toast is given a reading budget instead, and two ways for a human to
// take more: the timer holds while the pointer or the keyboard is on it, and
// every toast carries a dismiss control so it can also be sent away early.
//
// The floor is the OLD number, deliberately: an ordinary short confirmation
// behaves exactly as it always has, and nothing on the guest's phone becomes
// sticky. Only length buys more.
const DISMISS_MS = 3500
// ~18 characters a second. Comfortable prose is quicker than that; a Warden
// reading an instruction at eleven at night, on a counter screen, with a guest
// waiting, is not.
const READ_MS_PER_CHAR = 55
// A backstop, not the answer. Past this length the dismiss control and the
// hover hold are what the message actually relies on — a toast that outstays
// this is one somebody is meant to act on, not glance at.
const DISMISS_MAX_MS = 30000
// Handed back when the pointer leaves. Without it a message whose budget ran
// out under the cursor vanishes on the way to the dismiss control.
const RESUME_MIN_MS = 1200

function dwell(toast: ToastInput): number {
  const chars = toast.title.length + (toast.body?.length ?? 0)
  return Math.min(DISMISS_MAX_MS, Math.max(DISMISS_MS, Math.round(chars * READ_MS_PER_CHAR)))
}

/** One toast's countdown. `timer` is null exactly while it is being held. */
interface Countdown {
  timer: ReturnType<typeof setTimeout> | null
  left: number
  startedAt: number
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, Countdown>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const rec = timers.current.get(id)
    if (rec?.timer) clearTimeout(rec.timer)
    timers.current.delete(id)
  }, [])

  const arm = useCallback(
    (id: string, ms: number) => {
      const rec = timers.current.get(id)
      if (rec?.timer) clearTimeout(rec.timer)
      timers.current.set(id, {
        timer: setTimeout(() => dismiss(id), ms),
        left: ms,
        startedAt: Date.now(),
      })
    },
    [dismiss]
  )

  // Hold while a human is on it. A pointer resting on a message and a focus
  // ring sitting inside one mean the same thing — somebody is reading — so both
  // stop the clock, and both hand the unspent remainder back on the way out.
  const hold = useCallback((id: string) => {
    const rec = timers.current.get(id)
    if (!rec || !rec.timer) return
    clearTimeout(rec.timer)
    rec.timer = null
    rec.left = Math.max(0, rec.left - (Date.now() - rec.startedAt))
  }, [])

  const release = useCallback(
    (id: string) => {
      const rec = timers.current.get(id)
      if (!rec || rec.timer) return
      arm(id, Math.max(rec.left, RESUME_MIN_MS))
    },
    [arm]
  )

  const show = useCallback(
    (toast: ToastInput) => {
      const id = uid()
      const ms = dwell(toast)
      setToasts((prev) => [...prev, { ...toast, id, ms }])
      arm(id, ms)
    },
    [arm]
  )

  // The console tears this provider down on sign-out with messages still up.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((rec) => {
        if (rec.timer) clearTimeout(rec.timer)
      })
      pending.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div
            className="toast"
            key={t.id}
            onMouseEnter={() => hold(t.id)}
            onMouseLeave={() => release(t.id)}
            // Capture, so focus landing on the dismiss control inside counts as
            // focus on the message. React's onFocus/onBlur already bubble, but
            // capture also survives a caller nesting something focusable here.
            onFocusCapture={() => hold(t.id)}
            onBlurCapture={() => release(t.id)}
          >
            {t.icon && (
              <span style={{ color: 'var(--text-gold)', display: 'inline-flex', flex: '0 0 auto' }}>
                {LUCIDE_NAME.test(t.icon) ? <Icon name={t.icon} size={20} /> : t.icon}
              </span>
            )}
            {/* Capped and scrolled, for the same reason Dialog bodies are: the
                messages that need the long dwell are the ones long enough to
                push their own dismiss control off a phone screen. */}
            <div className="toast__text">
              <strong>{t.title}</strong>
              {t.body && <div>{t.body}</div>}
            </div>
            {/* Named after the message it closes: a screen reader running the
                console hears which of several it is about to send away. */}
            <button
              type="button"
              className="toast__dismiss"
              aria-label={`Dismiss: ${t.title}`}
              onClick={() => dismiss(t.id)}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
