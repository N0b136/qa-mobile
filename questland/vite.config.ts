import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// vite loads this config in Node; declare `process` so tsc does not require
// @types/node just for one env lookup.
declare const process: { env: Record<string, string | undefined> }

// Served from the domain root by default; a subpath deploy (e.g. GitHub Pages
// project sites at /<repo>/) sets DEPLOY_BASE=/qa-mobile/. All runtime asset
// paths read import.meta.env.BASE_URL, so they follow whatever is set here.
const base = process.env.DEPLOY_BASE || '/'

const entry = (file: string) => resolve(fileURLToPath(new URL('.', import.meta.url)), file)

// The Back Office installs as its own home-screen app, which is only possible
// because console.html is a separate document linking a separate manifest —
// install identity comes from the manifest the document links, so two apps need
// two documents. VitePWA injects the GUEST manifest into every HTML entry it
// sees, so swap that link on the console page; otherwise installing from the
// console would silently install the guest app.
function consoleManifest(): Plugin {
  const link = `<link rel="manifest" href="${base}console.webmanifest" />`
  const isConsole = (id: string) => id.endsWith('console.html')

  return {
    name: 'questland-console-manifest',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!isConsole(ctx.filename)) return html
        return html.replace('</head>', `  ${link}\n  </head>`)
      },
    },
    // VitePWA appends its own tags AFTER every transformIndexHtml handler and
    // after generateBundle, so the guest link cannot be swapped in either — it
    // does not exist yet. The first rel="manifest" wins per spec and ours is
    // first, but that is too quiet a thing to depend on, so drop the loser once
    // everything has been written. (This runs after VitePWA's own closeBundle,
    // so console.html's precache revision hash goes stale; harmless, because a
    // revision is only a cache key and is never verified against content.)
    closeBundle() {
      const built = entry('dist/console.html')
      if (!existsSync(built)) return
      const html = readFileSync(built, 'utf8')
      const stripped = html.replace(
        /\s*<link rel="manifest" href="[^"]*manifest\.webmanifest">/g,
        ''
      )
      if (stripped !== html) writeFileSync(built, stripped)
    },
  }
}

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      input: { main: entry('index.html'), console: entry('console.html') },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['icons/*.png'],
      manifest: {
        id: base,
        name: 'Questland Adventures',
        short_name: 'Questland',
        description:
          'Your gateway to the realms of Questland — quests, maps, bookings, and legend-making.',
        theme_color: '#1A1A1C',
        background_color: '#121214',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: `${base}icons/icon-maskable-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: `${base}icons/icon-maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webp,jpg,jpeg,ico,woff2,mp4}'],
        // Station card master PNGs (public/assets/stations/*.png) are source
        // art only — the app requests the optimized .webp siblings at
        // runtime, so keep the multi-MB masters out of the precache glob.
        globIgnores: ['**/assets/stations/*.png'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
    consoleManifest(),
  ],
  server: { host: true, port: 5173 },
})
