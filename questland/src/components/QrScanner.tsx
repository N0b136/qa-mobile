import * as React from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Icon, Button } from '../ui'

export interface QrScannerProps {
  /** Fired once with the decoded marker text; camera stops right after. */
  onDecode: (text: string) => void
  onClose: () => void
}

/**
 * Self-contained rear-camera QR reader. Never throws outward — any camera
 * failure (no device, permission denied, insecure context) degrades to a
 * DS message instead of a crash. Not exercised in this build env (no camera).
 */
export function QrScanner({ onDecode, onClose }: QrScannerProps) {
  const containerId = React.useId().replace(/[^a-zA-Z0-9-]/g, '') + '-qr-scan'
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let decoded = false
    let scanner: Html5Qrcode | null = null

    try {
      scanner = new Html5Qrcode(containerId)
    } catch {
      setError('unavailable')
      return
    }

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => {
          if (decoded || cancelled) return
          decoded = true
          onDecode(decodedText)
          scanner?.stop().catch(() => {})
        },
        () => {
          // per-frame "no code found" callback — expected on most frames, ignore
        }
      )
      .catch(() => {
        if (!cancelled) setError('unavailable')
      })

    return () => {
      cancelled = true
      const s = scanner
      if (!s) return
      if (s.isScanning) {
        s.stop()
          .catch(() => {})
          .finally(() => {
            try {
              s.clear()
            } catch {
              // noop — element may already be gone
            }
          })
      } else {
        try {
          s.clear()
        } catch {
          // noop
        }
      }
    }
    // containerId is stable for the component's lifetime; onDecode is captured fresh each start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId])

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          padding: 'var(--space-lg)',
          textAlign: 'center',
        }}
      >
        <span style={{ color: 'var(--status-locked)' }}>
          <Icon name="camera-off" size={28} />
        </span>
        <p className="muted" style={{ margin: 0 }}>
          Camera unavailable — use the Guide&rsquo;s code above.
        </p>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <div
        id={containerId}
        style={{
          width: '100%',
          minHeight: 220,
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          background: 'var(--surface-inset)',
        }}
      />
      <Button variant="ghost" size="sm" icon="x" onClick={onClose}>
        Cancel scan
      </Button>
    </div>
  )
}
