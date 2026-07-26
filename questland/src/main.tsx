import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'

// DS fonts (@fontsource, offline-capable — replaces ds/tokens/fonts.css CDN @import)
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/cinzel/900.css'
import '@fontsource/cinzel-decorative/700.css'
import '@fontsource/cinzel-decorative/900.css'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/500.css'
import '@fontsource/eb-garamond/400-italic.css'
import '@fontsource/eb-garamond/500-italic.css'
import '@fontsource/alegreya-sans/400.css'
import '@fontsource/alegreya-sans/500.css'
import '@fontsource/alegreya-sans/700.css'
import '@fontsource/alegreya-sans/800.css'
import '@fontsource/im-fell-english/400-italic.css'
import '@fontsource/im-fell-english-sc/400.css'

// DS tokens (verbatim mirror, see src/theme/ds/) — load before the bridge/global so
// global.css wins where it intentionally overrides ds/base.css
import './theme/ds/colors.css'
import './theme/ds/typography.css'
import './theme/ds/spacing.css'
import './theme/ds/elevation.css'
import './theme/ds/motion.css'
import './theme/ds/base.css'
import './theme/tokens.css'
import './theme/global.css'

import App from './App'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
