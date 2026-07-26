# UI kit — Quest companion app

The on-trail mobile companion, 390×844. **No existing app was supplied**, so this
is a brand-faithful proposal rather than a reproduction (see readme.md Caveats).

Open `index.html`.

| File | Screen |
| --- | --- |
| `TrailMap.jsx` | Photographic chart with station markers, next-station sheet, segmented Chart/Stations switch, vertical ProgressTrail |
| `StationCheckIn.jsx` | Station header, parchment puzzle panel, answer Input, seal claim (answer: **river**) |
| `Collection.jsx` | Seal grid with earned/locked filter and the season-pass pin |
| `Party.jsx` | Party roster with per-member seal counts, Switch preferences, parchment passage |
| `data.js` | Fake stations, party and seals |

## Interactions
- Tab bar switches Chart / Quests / Seals / Party.
- **Check in** → station screen. Type `river` → **Claim the seal** enables → ceremonial Dialog awards Riverkeeper.
- Chart/Stations segmented control swaps the map for the vertical progress trail.

## Notes
Touch targets are 44px+ (Button `lg` = 56, IconButton `lg` = 48). Sheets use
`--radius-lg` 10px — the only place that radius appears.
