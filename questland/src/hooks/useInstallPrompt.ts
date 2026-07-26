import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIos = /iphone|ipad|ipod/i.test(ua)
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
  return isIos && isSafari
}

/**
 * Stashes the Chrome/Android `beforeinstallprompt` event and exposes a
 * unified "can this guest add Questland to their home screen" surface.
 * iOS Safari has no programmatic prompt, so callers should show a DS Dialog
 * with manual Share-sheet steps when `platform === 'ios'`.
 */
export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

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

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
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

  const ios = !installed && isIosSafari()
  const canInstall = !installed && (Boolean(deferredEvent) || ios)
  const platform: 'android' | 'ios' | null = installed ? null : deferredEvent ? 'android' : ios ? 'ios' : null

  return { canInstall, installed, platform, promptInstall }
}
