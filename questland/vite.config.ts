import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// vite loads this config in Node; declare `process` so tsc does not require
// @types/node just for one env lookup.
declare const process: { env: Record<string, string | undefined> }

// Served from the domain root by default; a subpath deploy (e.g. GitHub Pages
// project sites at /<repo>/) sets DEPLOY_BASE=/qa-mobile/. All runtime asset
// paths read import.meta.env.BASE_URL, so they follow whatever is set here.
const base = process.env.DEPLOY_BASE || '/'

export default defineConfig({
  base,
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
        globPatterns: ['**/*.{js,css,html,png,svg,webp,jpg,jpeg,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { host: true, port: 5173 },
})
