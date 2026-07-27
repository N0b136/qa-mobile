import { useCallback, useEffect, useState } from 'react'
import { load, save } from '../services/store'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const SNOOZE_KEY = 'ql:installBannerSnoozedAt'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

const STANDALONE_QUERIES = ['(display-mode: standalone)', '(display-mode: fullscreen)', '(display-mode: minimal-ui)']

/** True when the app is running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  return STANDALONE_QUERIES.some((q) => window.matchMedia?.(q).matches)
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports as Macintosh, but with touch points.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

function isIosSafari(): boolean {
  if (!isIos()) return false
  // Chrome/Firefox/Edge on iOS also offer Add to Home Screen from their share menu,
  // so only in-app webviews (no share sheet) are excluded here.
  return !/fbav|fbin|instagram|line\/|micromessenger/i.test(navigator.userAgent)
}

function snoozed(): boolean {
  const at = load<number>(SNOOZE_KEY, 0)
  return at > 0 && Date.now() - at < SNOOZE_MS
}

/**
 * Stashes the Chrome/Android `beforeinstallprompt` event and exposes a
 * unified "can this guest add Questland to their home screen" surface.
 * iOS has no programmatic prompt, so callers should show a DS Dialog
 * with manual Share-sheet steps when `platform === 'ios'`.
 *
 * `dismissed` / `dismiss()` back the top install banner's "not now" — a
 * 7-day snooze persisted through the store (never localStorage directly).
 */
export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [dismissed, setDismissed] = useState(snoozed)

  useEffect(() => {
    if (installed) return

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setDeferredEvent(event as BeforeInstallPromptEvent)
    }
    function onAppInstalled() {
      setDeferredEvent(null)
      setInstalled(true)
    }
    function onDisplayModeChange() {
      if (isStandalone()) setInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    const mql = window.matchMedia?.('(display-mode: standalone)')
    mql?.addEventListener?.('change', onDisplayModeChange)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      mql?.removeEventListener?.('change', onDisplayModeChange)
    }
  }, [installed])

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return false
    await deferredEvent.prompt()
    const { outcome } = await deferredEvent.userChoice
    setDeferredEvent(null)
    if (outcome === 'accepted') setInstalled(true)
    return outcome === 'accepted'
  }, [deferredEvent])

  const dismiss = useCallback(() => {
    save(SNOOZE_KEY, Date.now())
    setDismissed(true)
  }, [])

  const ios = !installed && isIosSafari()
  const canInstall = !installed && (Boolean(deferredEvent) || ios)
  const platform: 'android' | 'ios' | null = installed ? null : deferredEvent ? 'android' : ios ? 'ios' : null

  return { canInstall, installed, dismissed, dismiss, platform, promptInstall }
}
