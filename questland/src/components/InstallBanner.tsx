import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { Button, Dialog, Icon, IconButton } from '../ui'

/**
 * Steps for platforms with no programmatic install (iOS). Shared by the top
 * banner and the More screen's "Install Questland" row.
 */
export function InstallStepsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="Add to home screen"
      onClose={onClose}
      width={420}
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <Icon name="share" size={20} style={{ color: 'var(--text-gold)', flexShrink: 0 }} />
          <span>
            Tap the <strong>Share</strong> control in your browser&apos;s toolbar.
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Icon name="square-plus" size={20} style={{ color: 'var(--text-gold)', flexShrink: 0 }} />
          <span>
            Choose <strong>Add to Home Screen</strong>, then confirm.
          </span>
        </div>
      </div>
    </Dialog>
  )
}

/** The banner itself — mounted only while it should be on screen. */
function InstallBannerBar({
  onGet,
  onDismiss,
}: {
  onGet: () => void
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ctaHover, setCtaHover] = useState(false)
  const [ctaPress, setCtaPress] = useState(false)

  // Reserve room above the fixed TopBar (and inside .screen padding) for as
  // long as the banner is up; the CSS vars are cleared again on unmount.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const apply = () => root.style.setProperty('--install-banner-height', `${el.offsetHeight}px`)
    apply()
    // The banner carries the notch inset itself, so the chrome below it must not.
    root.style.setProperty('--chrome-safe-top', '0px')
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--install-banner-height')
      root.style.removeProperty('--chrome-safe-top')
    }
  }, [])

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Install Questland"
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        zIndex: 55,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 10px 10px 4px',
        paddingTop: 'calc(var(--safe-top) + 10px)',
        // Gold metal band — the one place the app shouts. Gold stays metal
        // (a struck gradient, never a flat fill), so the CTA inverts to carved
        // stone rather than sitting gold-on-gold.
        background: 'var(--gradient-gold)',
        borderBottom: '1px solid var(--gold-900)',
        boxShadow: 'var(--shadow-md)',
        // This banner is mounted at the App root, outside GateIntro/Shell, so
        // it can't read the intro's local `phase`. It shares the intro's own
        // signal instead: GateIntro sets `--intro-ui-delay` on <html> to 0s
        // immediately whenever there's no active playback (already seen /
        // reduced motion / not the Home route) and only to a real ~4.55s
        // while the gate is genuinely playing at a fresh Home load. Reusing
        // that var (fallback 0s, so routes before Home/GateIntro ever mounts
        // this session are unaffected) makes the banner fade in step with
        // TopBar/BottomNav/Home instead of popping in solid over the video.
        opacity: 0,
        animation: 'qa-fade-in var(--dur-reveal) var(--ease-out-door) var(--intro-ui-delay, 0s) both',
      }}
    >
      <IconButton
        icon="x"
        label="Dismiss install banner"
        size="sm"
        onClick={onDismiss}
        style={{ color: 'var(--stone-900)', flexShrink: 0 }}
      />
      <img
        src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
        alt=""
        aria-hidden="true"
        style={{
          width: 52,
          height: 52,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--gold-900)',
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            font: '700 var(--text-md)/1.15 var(--font-display)',
            letterSpacing: 'var(--tracking-display-tight)',
            textTransform: 'uppercase',
            color: 'var(--stone-950)',
          }}
        >
          Install Questland
        </div>
        <div
          style={{
            font: '600 var(--text-sm)/1.3 var(--font-ui)',
            color: 'rgba(18,18,20,.78)',
            marginTop: 3,
          }}
        >
          Faster entry, even offline.
        </div>
      </div>
      <Button
        size="lg"
        variant="primary"
        onClick={onGet}
        onMouseEnter={() => setCtaHover(true)}
        onMouseLeave={() => {
          setCtaHover(false)
          setCtaPress(false)
        }}
        onMouseDown={() => setCtaPress(true)}
        onMouseUp={() => setCtaPress(false)}
        style={{
          flexShrink: 0,
          background: ctaPress ? 'var(--stone-950)' : ctaHover ? 'var(--stone-700)' : 'var(--stone-900)',
          color: 'var(--gold-200)',
          border: '1px solid var(--stone-950)',
          boxShadow: ctaPress ? 'var(--shadow-carve-in)' : 'var(--shadow-sm)',
          transform: ctaPress ? 'translateY(1px)' : 'none',
        }}
      >
        Get
      </Button>
    </div>
  )
}

/**
 * Top-of-app install invitation for the browser build. Never renders once the
 * app is running installed (standalone / home-screen), and stays down for a
 * week after a guest dismisses it.
 */
export default function InstallBanner() {
  const { canInstall, installed, dismissed, dismiss, platform, promptInstall } = useInstallPrompt()
  const [showSteps, setShowSteps] = useState(false)
  const { pathname } = useLocation()

  // The staff console is a desktop tool — no home-screen pitch there.
  const suppressed = pathname.startsWith('/console')

  useEffect(() => {
    if (installed) setShowSteps(false)
  }, [installed])

  if (suppressed || installed || !canInstall || dismissed) return null

  function handleGet() {
    if (platform === 'ios') setShowSteps(true)
    else promptInstall()
  }

  return (
    <>
      <InstallBannerBar onGet={handleGet} onDismiss={dismiss} />
      {showSteps ? <InstallStepsDialog onClose={() => setShowSteps(false)} /> : null}
    </>
  )
}
