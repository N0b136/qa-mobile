import { createContext, useCallback, useContext, useRef, useState } from 'react'
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
}

interface ToastContextValue {
  show: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
const DISMISS_MS = 3500

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const show = useCallback(
    (toast: ToastInput) => {
      const id = uid()
      setToasts((prev) => [...prev, { ...toast, id }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS)
      )
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.icon && (
              <span style={{ color: 'var(--text-gold)', display: 'inline-flex', flex: '0 0 auto' }}>
                {LUCIDE_NAME.test(t.icon) ? <Icon name={t.icon} size={20} /> : t.icon}
              </span>
            )}
            <div>
              <strong>{t.title}</strong>
              {t.body && <div>{t.body}</div>}
            </div>
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
