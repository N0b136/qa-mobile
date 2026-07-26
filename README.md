# Questland Adventures

A pitch-ready mobile **PWA** for **Whispering Woods Adventure Park** — the guest-facing app for the fantasy adventure park set in the Wilds of Questia. Polished enough to hand someone a phone and walk them through the whole experience live, and architected so it can later be hardened into the real production app rather than thrown away.

Guests can: create an account and onboard into one of three in-lore orders, explore an interactive park map, track quest/level progression across 10-episode questlines, book visits (simulated payment), receive notifications, link up into a party, climb the leaderboard, and call for help while on a quest. A hidden demo console drives the live pitch.

## Stack

- **React 19** + **TypeScript** + **Vite 7**
- **vite-plugin-pwa** (Workbox service worker + web manifest — installable, offline-capable)
- **react-router-dom v7**
- Design-system tokens (no CSS framework) · fonts bundled via `@fontsource` (offline) · icons via `lucide-react`
- **Local-first service layer** (`questland/src/services/`, localStorage-backed) that mirrors Firestore collections, so Firebase can swap in later without touching components.

## Repository layout

```
.
├─ questland/          # the app (React + TS + Vite PWA)
│  ├─ src/
│  │  ├─ content/      # all lore/copy/config as editable data (orgs, quests, tiers, map coords…)
│  │  ├─ services/     # local-first data layer (localStorage now, Firebase-ready)
│  │  ├─ screens/      # route screens
│  │  ├─ ui/           # ported design-system components
│  │  └─ theme/        # design tokens (dark-first stone + gold)
│  ├─ public/assets/   # brand rasters, park map, app icons
│  └─ scripts/         # icon generation, asset optimization, map coord verification
├─ design-system/      # design-system canon, mirrored (readme.md is authoritative)
├─ content-intake/     # source canon: season schedule, ticketing, park map, brand art
├─ design/             # pre-DS UI brief (superseded where it conflicts with design-system/)
└─ CLAUDE.md           # workspace guide + build status
```

## Prerequisites

- **Node.js 20.19+** (or 22.12+ / 24.x) and npm — Vite 7 requires a modern Node.

## Getting started

```bash
cd questland
npm install
npm run dev
```

Open the printed local URL. The app is designed for a **375×812** mobile viewport — use your browser's device toolbar (or a real phone on the same network). The PWA/service worker is enabled in dev.

## Scripts (run inside `questland/`)

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server (PWA enabled). |
| `npm run build` | Type-check (`tsc -b`) and build the production bundle to `dist/`. |
| `npm run preview` | Serve the built `dist/` with the **real** production service worker. |
| `npm run icons` | Regenerate PWA/app icons from the master art in `content-intake/`. |
| `npm run optimize:brand` | Optimize brand raster assets. |

## Testing on a real phone

A service worker (install + offline) only registers in a **secure context** — `https://` or `localhost`. A plain `http://<lan-ip>` URL on a phone will load the app but **won't install or work offline**. To exercise the full PWA on a device, build and serve over HTTPS:

```bash
npm run build
npm run preview        # serves dist/ on http://localhost:4173
```

…then expose `localhost:4173` over HTTPS with a tunnel (e.g. a Cloudflare quick tunnel) and open that URL on the phone. On iOS, install via Safari's **Share → Add to Home Screen**; on Android, use the in-app install prompt.

## Demo console

The live-pitch remote lives at `/demo`, reached by **tapping the top-bar logo 7 times**. From there you can seed a demo world (cast, parties, mid-season progress, a booking, an open SOS), fire notifications, dispatch/resolve calls for aid, and reset the demo data (your host account and session are kept).

## Conventions

- **Content is data.** Lore, copy, pricing, quiz questions, and map coordinates live in `questland/src/content/*.ts` — edit there, no component changes needed.
- **Design system is canon.** Read `design-system/readme.md` before any UI work: dark-first stone ground, gold reserved for primary actions, track colors (Rangers = ruby, Hearers = green, Order of the Elm = sapphire), Cinzel/EB Garamond/Alegreya Sans type. **No emoji anywhere** — Lucide icons only.
- **Local-first.** Components never touch `localStorage` directly; they go through `src/services/`, which is shaped to swap in Firebase later.

## Status

Pitch prototype is complete across all build phases (auth/onboarding, questlines + progression, interactive map, booking, notifications, help/SOS, party linking, leaderboard, demo console, PWA polish). Remaining work is pre-production only: a real Firebase/FCM backend for closed-app web push. See `CLAUDE.md` for the detailed build log.
