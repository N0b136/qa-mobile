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

## Local delta — gemstone buttons (2026-08-19)

Applied from the owner's `Questland_Adventures_Design_System.zip`
(`design_handoff_gemstone_buttons/`), which post-dates the 2026-07-25 mirror:

- **Added** `tokens/gem-button.css` (verbatim) and its `styles.css` import,
  which loads after `motion.css` and before `base.css`.
- **Replaced** `components/core/Button.jsx` + `.d.ts` and
  `components/core/IconButton.jsx` + `.d.ts` (verbatim from the handoff).
- `tokens/colors.css` was byte-identical in the handoff — the palette did not
  move; only the button chassis is new.

**`readme.md` is deliberately NOT edited** — it is verbatim remote content and
should be regenerated upstream. Until it is, three of its rules are superseded
for buttons only:

| readme.md says | gemstone handoff says |
| --- | --- |
| "Ruby and Sapphire … never use them as button fills" | `secondary` is a sapphire gem, `danger` a ruby gem |
| `--radius-sm 4px` (cards, **buttons**) | buttons are an emerald-cut octagon via `clip-path`, radius 0 |
| Hover: gold fill `--gold-600` → `--gold-500` | Hover: `brightness(1.15) saturate(1.15)` + a gem-coloured glow |

Everything else the readme states about buttons still holds: ALL CAPS labels,
1–3 words, one primary per view, disabled renders as carved stone (never a
dimmed gem), and press is down-and-darker with no scale.
