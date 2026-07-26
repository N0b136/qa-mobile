# Mirror notes — local copy of the Claude Design project

Source: claude.ai/design project `fd4a099b-4d30-456b-92fa-c7d33afaf0dd`
("Questland Adventures Design System"), mirrored 2026-07-25 via the DesignSync
connector. All mirrored files are verbatim remote content.

## Mirrored (44 files)
- Root: `readme.md` (authoritative), `styles.css`, `SKILL.md`,
  `_ds_manifest.json` (see note inside — remote `tokens` array omitted),
  `_adherence.oxlintrc.json`, this file.
- `tokens/` — all 7 css files.
- `components/` — all 20 components as `.jsx` + `.d.ts`
  (core 9, forms 5, feedback 3, navigation 3).
- `ui_kits/app/` — README.md, data.js, index.html, TrailMap, StationCheckIn,
  Collection, Party (the direct references for our app screens).
- `uploads/parchment-card-handoff.md` — the vellum-card spec.

## Deliberately NOT mirrored (and why)
- `assets/*` (9 PNGs + 1 MP4) and `uploads/*` binaries — over/near the 256 KiB
  `get_file` cap and prohibitively expensive to base64 through the connector.
  **Ask the owner to drop these files into `content-intake/` or
  `design-system/assets/`**, most importantly `logo-questland-primary.png`,
  `logo-questland-on-stone.png`, and the three badge PNGs (Seal component art),
  plus the four `img-*.png` photos.
- `_ds_bundle.js` — compiled browser bundle of the component sources above;
  the app consumes the sources, not the bundle. `ui_kits/*/index.html` preview
  pages reference it, so they won't run locally until it (or the assets) are
  exported; read the .jsx files instead.
- `guidelines/*.card.html` (23 files) — visual specimen cards for the Design
  System pane; every rule they illustrate is stated in `readme.md` and encoded
  in `tokens/*.css`.
- `ui_kits/website/` (8 files) — marketing-site kit; out of scope for the
  mobile app build. Mirror later if the website becomes a deliverable.
- `components/**/*.prompt.md` and `components/**/*.card.html` — Claude Design
  regeneration prompts / pane previews; not needed to consume the components.
- `thumbnail.html`, `.thumbnail`, `guidelines/explorations/` — project-tile
  chrome and early explorations.
