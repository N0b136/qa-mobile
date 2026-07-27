// Entry point for the Back Office console as its OWN installable app.
//
// console.html is a second Vite entry with its own web app manifest, which is
// what makes it a separate home-screen icon rather than a route inside the
// guest app: install identity comes from the manifest the *document* links, so
// two installable apps need two documents. Staff get a console-only surface
// with no guest chrome, and the guest app keeps its own icon and its own
// storage-free launch.
//
// The /console route inside the guest app still works and renders the same
// screen. This entry is the installable door to it.

import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

// Same font + token load order as main.tsx — global.css must win where it
// intentionally overrides ds/base.css.
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/cinzel/900.css'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/500.css'
import '@fontsource/alegreya-sans/400.css'
import '@fontsource/alegreya-sans/500.css'
import '@fontsource/alegreya-sans/700.css'
import '@fontsource/alegreya-sans/800.css'

import './theme/ds/colors.css'
import './theme/ds/typography.css'
import './theme/ds/spacing.css'
import './theme/ds/elevation.css'
import './theme/ds/motion.css'
import './theme/ds/base.css'
import './theme/tokens.css'
import './theme/global.css'

import { ToastProvider } from './components/Toast'
import ConsoleScreen from './screens/console/ConsoleScreen'

registerSW({ immediate: true })

// ToastProvider is required, not decoration: SendWord calls useToast(), which
// throws without it. In the guest app App.tsx wraps the whole route tree, so
// the console inherited one for free — mounting it standalone does not.
//
// No Router, though: every console screen is plain component state, so there
// is no route to match and nothing to keep in the URL.
createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <ConsoleScreen />
  </ToastProvider>
)
