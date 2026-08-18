# Questland Adventures — Design System

Medieval-themed outdoor adventure park. Guests (primarily families) walk a forest
trail through interactive stations and uncover an unfolding story told in
**episodes** of **questlines**. The register is *storybook fantasy meeting
historical medieval* — carved stone and forged iron, timber-frame buildings,
canvas pavilions, wax seals and gemstone talismans, but always warm and
family-legible rather than grim or gory.

## Sources given

Everything in this system was derived from the following uploads. No codebase,
Figma file, or existing product UI was provided.

| Source | What it gave us |
| --- | --- |
| `uploads/Untitled design (3).png` | **Primary logo (original render)** — gemstone "Q" (ruby left / sapphire right) inside a filigree gold ring with diamond gem cardinal points, over a dark slate wall, with a gold map-engraved ribbon reading QUESTLAND / ADVENTURES. Copied to `assets/logo-questland-on-stone.png`. This is the source of truth for the palette. |
| `uploads/parchment-card-handoff.md` | **Parchment-card design handoff** — the authoritative spec for the vellum card: palette, type, SVG tear filters, tear variants and `--p-*` knobs. Implemented in `components/core/Card.jsx` (`tone="parchment"`) and specimened in `guidelines/vellum-card.card.html`. |
| `uploads/QA LOGO.png` | **Transparent-background version of the same lockup**, 2000×2000 with a real alpha channel. Copied to `assets/logo-questland-primary.png` — this is the one every surface uses. (An earlier `Copy of Untitled.svg` was supplied but contained empty `<image>` placeholders with no embedded data and could not be used.) |
| `uploads/Gemini_Generated_Image_3iub793iub793iub - Edited.png` | Gold-and-black-enamel crowned tree pin — the badge/collectible visual language. `assets/badge-crowned-realm-gold.png` |
| `uploads/Gemini_Generated_Image_ - Edited (1).png` | Bronze compass-rose-and-sword medallion with a forest/mountain scene. `assets/badge-compass-sword.png` |
| `uploads/Gemini_Generated_Image_q9plfgq9plfgq9pl - Edited.png` | Carved stone relief of a pomegranate tree over a river. `assets/relief-pomegranate-tree-stone.png` |
| `uploads/Starting_from_this_picture_a.mp4` | 10s clip, 1280×720: camera pushes through a stone-arched timber gate into a woodland village square (pavilions, blacksmith, "Adventurer's Outfitters", campfire). Copied whole to `assets/video-gate-opening.mp4`; four frames extracted as the system's photography set. |

No brand copy, tone-of-voice document, font binaries, or icon set was supplied —
see **Caveats** at the bottom for what that means.

---

## Products represented

The uploads describe a physical park, not software, so the surfaces here are the
two digital products such a park inevitably needs. Both are recreations of the
*brand*, not of any existing screen we were shown:

1. **Marketing website** (`ui_kits/website/`) — the ticket-selling storefront:
   gate hero, questline browser, episode detail, plan-your-visit.
2. **Quest companion app** (`ui_kits/app/`) — the on-trail mobile companion:
   trail map, station check-in with seal reveal, badge collection, party progress.

---

## CONTENT FUNDAMENTALS

### Voice
The park speaks as a **guild that has been expecting you**. Warm, ceremonious,
slightly archaic — never sneering-medieval ("Hark! Thou dost…") and never
theme-park-shouty ("BIGGEST THRILLS EVER!!"). The narrator has authority and
kindness, like a good gamemaster.

### Person
Second person, singular-collective: **"you"** meaning your whole party.
The park refers to itself as **"we"** or, in-world, **"the Guild"**.
Never "our guests" in guest-facing copy — that's back-office language.

- ✅ "Your party's first seal is waiting at the gate."
- ✅ "We open the gate at nine. Come early; the light is better."
- ❌ "Guests may collect their first seal at the entrance."

### Casing
- **Display headings:** ALL CAPS in Cinzel with generous tracking (`--tracking-display`).
  This mirrors the incised capitals of the logo ribbon. Keep them under 6 words.
- **Body and subheads:** sentence case. Never title case a sentence.
- **Buttons and wayfinding labels:** ALL CAPS, `--tracking-label`, 1–3 words —
  `BEGIN THE QUEST`, `BOOK YOUR VISIT`, `NEXT STATION`.
- **In-world proper nouns are capitalised:** the Gate, the Guild, the Hollow,
  Episode III, Seal of the Wilds.

### Naming system
Adopt the story vocabulary consistently — it is the single most brand-defining
copy decision.

| Generic term | Questland term |
| --- | --- |
| Trail / route | **Questline** |
| Stop / activity | **Station** |
| Chapter of a questline | **Episode** |
| Ticket | **Passage** (a "day passage", "season passage") |
| Group booking | **Party** |
| Reward sticker/stamp | **Seal** |
| Achievement | **Badge** |
| Map | **Chart** (or just "the map" — don't overdo it) |
| Staff member | **Guide** (in-world: **Warden**) |

### Sentence rhythm
Short declaratives, then one longer image-carrying line. Fragments are allowed
for atmosphere. Em dashes for the aside; semicolons almost never.

> **THE GATE OPENS AT NINE**
> Four questlines. Twenty-two stations. One story that only finishes if you
> walk it. Bring good boots — the Hollow is muddy after rain.

### Numbers and specifics
Always prefer a concrete number to an adjective. "Twenty-two stations" beats
"lots to do". Spell out numbers one–twelve in prose; use digits in UI, prices,
times and durations (`2 hr 15 min`, `£24`, `9:00`).

### Emoji
**Never.** Not in UI, not in marketing, not in the app. The brand's small
graphic accents are the four-point star ✦-shaped ornament found in the logo
ribbon and gold hairline rules — rendered as CSS/asset ornaments, not emoji.

### Things we don't say
No "immersive experience", "unforgettable memories", "fun for all ages",
"escape reality". No exclamation marks in more than one place per page. No
LARP-speak, no "milady", no fake Old English spellings (`ye olde`).

### Safety, accessibility, and price copy
Plain, direct, no theming. Costume comes off when clarity matters:
"Step-free route available for all of Emberpath. The Hollow has 40 stairs."

---

## VISUAL FOUNDATIONS

### Colour
- **Guild Gold** (`--gold-600` `#A87848` core, `--gold-300` `#E3C88E` highlight) is
  the brand colour and the *only* colour used for primary action. It is treated
  as **metal, not paint** — always with a lighter edge above and darker below
  (`--gradient-gold`, `--shadow-carve-in`), never as a flat fill on large areas.
- **Ruby** (`--ruby-500`) and **Sapphire** (`--sapphire-500`) come from the two
  halves of the Q. They are *narrative* colours, not UI colours: they mark the
  two original questline tracks (Valor / Lore) and appear as gem glints. Never
  use them as button fills.
- **Stone** (`--stone-950`→`--stone-200`) is the default ground. The system is
  **dark-first** — the logo lives on a slate wall and so does the product.
- **Parchment** (`--parchment-50`→`--parchment-500`) is the light counterpart,
  used for anything that is diegetically a document: maps, tickets, episode
  scrolls, printed signage. Switching to parchment is a *content-type* signal,
  not a theme toggle. Wrap it in `.qa-on-parchment` to flip text semantics.
  Parchment surfaces are **hand-torn animal-skin vellum**, built to the
  `parchment-card-handoff.md` spec: the hide (follicle grain + mottled thick/thin
  patches + edge scorch + base skin tone) sits on a layer *behind* the content and is
  displaced by an `feTurbulence` + `feDisplacementMap` SVG filter, so the tear is
  irregular while the text on top stays crisp. A second layer carries the darkened
  worn inner rim, and the cast shadow follows the tear. Four tear variants
  (`a` / `b` / `c` / `rough`) exist so repeats in a grid look hand-torn — vary them.
  **`rough` is the default**; `a`/`b`/`c` are gentler rips.
  Per-instance knobs: `--p-hue` (36), `--p-light` (80), `--p-ink`, `--p-pad`.
  Vellum carries **no border and no corner radius**, a 14px margin for the ragged
  overhang, and switches type to the scribe voice (IM Fell English SC kickers,
  IM Fell English headings, EB Garamond body, sepia `--vellum-ink` #3b2a16).
  `Card tone="parchment"` does all of this for you; the filter defs inject once per page.
  Palette: skin `#ece0c4` → tanned `#b89b6a`, scorch `#8a6d43`, wax seal `#7a2e22`,
  leather backdrop `#241a12`. Note `feDisplacementMap` is not cheap — fine for a
  handful of cards, not hundreds on one screen.
- **Woodland** greens and **Timber** browns are sampled from the park
  photography and used for track colours and illustrative chrome only.
- **Ember** (`--ember-500`) is firelight: live/now states, "open today",
  progress in flight. Sparingly.
- Rule: **max two background colours per composition** — a stone ground and one
  parchment panel, or a photograph and a stone scrim.

### Type
- `--font-display` **Cinzel** — all headings, wordmarks, station signage, buttons'
  bigger siblings. Caps, tracked out. Sizes step hard: `--text-6xl` hero,
  `--text-3xl` section, `--text-xl` card. Never below `--text-md` in Cinzel.
- `--font-body` **EB Garamond** — story and long-form. Generous
  `--leading-relaxed`, measure capped at ~66 characters (`--container-narrow`).
- `--font-ui` **Alegreya Sans** — every functional label, time, price, tab,
  form field and small button. It is the only face allowed under 14px.
- `--font-scribe` **IM Fell English Italic** — the in-world "hand": quest notes,
  marginalia, a Warden's aside. Never more than two lines at a time.
- `--font-display-ornate` **Cinzel Decorative** — drop caps and episode numerals
  only. Roughly once per screen, at most.

### Backgrounds
Three legitimate grounds, in this order of preference:
1. **Stone**: `--texture-stone` — a near-black slate wash with a soft top-left
   light. This is the default page.
2. **Full-bleed photography** of the park: gate, village square, trail. Always
   full-bleed edge-to-edge, always with a protection scrim (below). Cropped so a
   built structure or path leads the eye; never a floating hero image in a card.
3. **Parchment**: `--texture-parchment` for documents.

No repeating tiled patterns, no illustrated "fantasy map" wallpaper behind text,
no aggressive gradients. Gradients exist only as (a) gold-leaf metal edges,
(b) the ruby→sapphire gem gradient inside the logotype, (c) protection scrims.

### Protection: gradients, not capsules
Type over photography sits on a **gradient scrim** (`--scrim-bottom` for the
common bottom-anchored case, `--scrim-top` for headers, `--scrim-full` when the
image is busy). Copy on top of a scrim uses **`--text-on-media`** /
`--text-on-media-muted`, never `--parchment-100` directly — those two tokens flip
with the *scrim*, so a light-ground theme can invert them to dark ink without
touching the page's own text colours. Solid capsules/pills behind text are avoided — they read as web
UI stuck onto a photo. The single exception is a small live-status pill (e.g.
`OPEN TODAY`), which is a deliberate object, not protection.

### Imagery colour vibe
Park photography is **cool and slightly desaturated** — pine green, grey stone,
bleached canvas, soft haze in the trees — with a **single warm ember accent**
(a fire, a lantern, a lit forge doorway). Light is early-morning or late-golden;
never harsh midday, never blue-hour dark. Fine grain is welcome; heavy filters,
teal-orange grades and vignettes are not. Faces are visible but the park, not
the person, is the subject.

### Borders and frames
- Default separation is a **1px gold hairline at low opacity**
  (`--border-hairline`) — light catching an edge, not a drawn box.
- Emphasis uses `--border-strong`; a *ceremonial* frame (episode reveal, badge
  earned, ticket) uses a `--border-frame` 6px gold-gradient border with an inner
  1px dark line, echoing the logo's double ring.
- Parchment documents get a `--border-parchment` edge plus `--shadow-parchment`.

### Shadow system
Shadows describe **carving and weight**, not floating cards.
- `--shadow-carve-in` (inset dark top / faint gold bottom) is the signature: it
  makes a surface look cut *into* stone. Used on inputs, wells, inactive tabs.
- `--shadow-xs`/`sm`/`md`/`lg` are plain black drops, low blur, high opacity —
  the light is hard.
- `--shadow-lift` (drop + gold ring) is the hover state for anything clickable
  and card-shaped.
- `--shadow-gold-glow`, `--shadow-gem-ruby`, `--shadow-gem-sapphire` are *event*
  shadows: a seal being awarded, an active gem, a completed questline.
- Never a large soft diffuse shadow. Never coloured shadows outside those three.

### Corner radii
Tight and mostly square, because the objects are carved, forged or printed:
`--radius-xs 2px` (inputs, chips), `--radius-sm 4px` (cards, buttons),
`--radius-md 6px` (modals, panels), `--radius-lg 10px` (phone-app sheets only).
`--radius-pill` is reserved for status pills and the app's segmented control.
**`--radius-arch`** gives the gate/window silhouette — a top-only arch used for
episode cards, station markers and the app's reveal sheet. It is the brand's one
distinctive shape.

### Cards
A card is a stone slab: `--surface-card` fill, `--border-hairline` 1px edge,
`--radius-sm`, `--shadow-sm`, and internal padding of `--space-lg`. Titles in
Cinzel caps `--text-xl`, meta in Alegreya Sans `--text-xs` uppercase gold.
Hover raises to `--shadow-lift` and brightens the border to `--border-strong`;
nothing scales up. Photographic cards are full-bleed image + `--scrim-bottom` +
text in the bottom-left, no inner padding around the image.

### Transparency and blur
Used only where something is genuinely *in front of* something else: the sticky
site header over photography (`--surface-overlay` + `--blur-veil`), modal
backdrops, and the app's bottom sheet. Never on cards, never as decoration,
never a "glassmorphism" panel over a flat colour.

### Layout rules
- 12-column grid, `--gutter` 24px (`--gutter-lg` 40px ≥1200px),
  `--container-max` 1240px, prose capped at `--container-narrow` 720px.
- Fixed elements: site header (`--header-h` 72px, sticky, translucent, gains a
  gold hairline bottom border once scrolled) and the app tab bar
  (`--tabbar-h` 64px, opaque stone, gold hairline top).
- Vertical rhythm between sections is `--space-4xl` 96px on web, `--space-2xl`
  48px in the app. Sections are separated by space or a `.qa-rule` gold
  hairline — not by alternating background colours.
- Full-bleed image bands break the container deliberately, once or twice a page.

### Animation
Motion is **mechanical and deliberate** — doors, seals, lanterns. Nothing
bounces, nothing springs, nothing bobs.
- Reveals (episode unlock, gate transition) use `--ease-out-door` over
  `--dur-reveal` 720ms: a slight overshoot-free deceleration, like a heavy door.
- Closing/locking uses `--ease-in-seal`.
- All control feedback is `--dur-fast` 160ms `--ease-standard`.
- Ambient loops (torch flicker, gem shimmer) use `--ease-lantern` over
  `--dur-ambient` 4200ms at very low amplitude (≤6% opacity swing).
- Entrances are **fade + 8–12px rise**. No slide-in from off-screen, no
  scale-from-zero, no stagger longer than 60ms per item.
- All of it collapses under `prefers-reduced-motion` (handled in `motion.css`).

### Hover states
Lighten, never darken — the metaphor is light catching metal.
- Gold buttons: fill `--gold-600` → `--gold-500`, plus `--shadow-gold-glow`.
- Cards/tiles: border `--border-hairline` → `--border-strong`, shadow → `--shadow-lift`.
- Text links and ghost buttons: `--text-link` → `--text-link-hover`; underline
  colour strengthens. Opacity-only hovers are not used.
- Icons: `--text-muted` → `--text-gold`.

### Press states
Press goes **darker and down**: `--gold-700` fill, `translateY(1px)`, and
`--shadow-carve-in` so the control looks pushed into the stone. Duration
`--dur-instant` 90ms. No scale-down.

### Disabled / locked
Locked content is a first-class brand state (episodes unlock in order):
`--status-locked` text, 1px dashed hairline border, no shadow, and the arch
silhouette kept so the shape still reads. Never 40% opacity on everything.

### Focus
2px solid `--focus-ring` gold at 2px offset, always visible, never removed.

---

## ICONOGRAPHY

**No icon set was supplied with the brand assets.** The system therefore uses
**Lucide** (CDN, `lucide@0.469.0`) as a documented substitution, chosen because
its 2px-stroke, square-cap, 24px-grid line style sits closest to the engraved
line quality of the supplied bronze medallion and gold pin. → *Flagged for
replacement; see Caveats.*

- **Style contract:** outline only, `stroke-width: 2`, `stroke: currentColor`,
  24px box (20px in dense app rows, 32px for wayfinding). No filled icon
  variants, no duotone, no icons inside coloured circles.
- **Colour:** icons take `--text-muted` at rest, `--text-gold` on hover/active,
  `--brand-on-primary` inside a gold button.
- **Preferred glyph vocabulary** (Lucide names): `map`, `map-pin`, `compass`,
  `route`, `footprints`, `swords`, `shield`, `crown`, `scroll-text`, `key-round`,
  `flame`, `trees`, `tent`, `castle`, `ticket`, `users`, `clock`, `calendar`,
  `stamp`, `award`, `lock`, `chevron-right`, `arrow-right`, `x`, `menu`.
- **Brand ornaments are assets, not icons.** The four-point star ✦ from the logo
  ribbon, the compass medallion, the crowned tree and the stone relief are used
  as raster brand marks at size — they are never redrawn as line icons and never
  recoloured.
- **Badges/seals** in the app are photographic renders of physical objects (the
  gold pin, the bronze medallion, the stone relief), not vector icons. New seals
  should be photographed or rendered in the same object language.
- **Emoji: never**, in any surface. **Unicode as icon:** only `✦` (U+2726) as a
  typographic ornament in rules and between metadata items, and `·` as a
  separator. Nothing else.
- **We do not draw new SVG marks in this system.** If a needed glyph is missing
  from Lucide, request it from the brand owner rather than approximating it.

### Assets on hand (`assets/`)
| File | Use |
| --- | --- |
| `logo-questland-primary.png` | **Primary logo lockup — transparent PNG, 2000×2000.** Use this everywhere. Minimum width 180px; clear space = height of the ribbon on all sides. Sits on stone, on a scrimmed photo, or any dark/mid ground — never on parchment, cream or gold, where the gold-on-gold has no contrast. |
| `logo-questland-on-stone.png` | The original square render with its slate-wall backdrop baked in. Fallback only — for square avatars, favicons and social tiles that need a filled plate. |
| `badge-crowned-realm-gold.png` | Gold/black enamel pin — crowned tree over forest. Order of the Realm mark; season-pass and top-tier badge art. |
| `badge-compass-sword.png` | Bronze medallion. Wayfinding/explorer badge art. |
| `relief-pomegranate-tree-stone.png` | Carved stone relief. Chapter/section mark, "story" motif. |
| `img-gate-closed.png`, `img-gate-threshold.png` | The gate. Hero and transition imagery. |
| `img-village-path.png`, `img-village-square.png` | The village square. Editorial/section imagery. |
| `video-gate-opening.mp4` | 10s gate-opening clip for the website hero (muted, looped, poster = `img-gate-closed.png`). |

There is **no** secondary/monochrome logo, favicon, or wordmark-only lockup in
the supplied set, and none has been invented.

---

## Index

**Root**
- `styles.css` — the single entry point consumers link. `@import` list only.
- `readme.md` — this file.
- `SKILL.md` — Agent-Skill wrapper so this folder works in Claude Code.
- `thumbnail.html` — homepage tile.

**`tokens/`** — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`,
`elevation.css`, `motion.css`, `base.css`.

**`guidelines/`** — foundation specimen cards (Design System tab):
colour (gold, gem, stone, parchment, woodland, semantic), type (display, body,
UI, scribe, scale), spacing, radii & the arch, shadows, scrims, motion, brand
marks, photography, ornament.

**`components/`**
- `core/` — `Button`, `IconButton`, `Badge`, `Tag`, `Card`, `ArchCard`, `Seal`, `Ornament`
- `forms/` — `Input`, `Select`, `Checkbox`, `Radio`, `Switch`
- `feedback/` — `Dialog`, `Tooltip`, `ProgressTrail`
- `navigation/` — `Tabs`, `SiteHeader`, `TabBar`

**`ui_kits/`**
- `website/` — `index.html`, `README.md`, screens: Home, Questlines, EpisodeDetail, Visit
- `app/` — `index.html`, `README.md`, screens: TrailMap, StationCheckIn, Collection, Party

---

## Intentional additions

Because no source component library existed, the component set is the standard
primitive inventory plus four brand-specific pieces that the park's content
model demands:
- **`ArchCard`** — the `--radius-arch` gate-silhouette card used for episodes and
  stations. Without it, the brand's one distinctive shape has no carrier.
- **`Seal`** — the awarded-seal object (badge art + ceremonial gold frame).
- **`ProgressTrail`** — episode/station progress as a walked path with locked,
  current and completed nodes; the core repeated pattern in the app.
- **`Ornament`** — the ✦ / gold-hairline divider, so the ornament is never
  hand-rolled per screen.

---

## Caveats

1. **Fonts are substitutions.** No binaries were supplied. Cinzel, EB Garamond,
   Alegreya Sans and IM Fell English are loaded from Google Fonts as the nearest
   matches to the logotype's flared roman capitals. Please supply the real
   licensed families.
2. **Icons are a substitution.** Lucide via CDN stands in for an unsupplied set.
3. **No product UI existed to recreate.** Both UI kits are brand-faithful
   originals built from the logo, photography and stated positioning — not
   reproductions of shipped screens. Treat them as proposals.
4. **No secondary logo, monochrome mark or favicon** exists; none was invented. The
   supplied lockup comes in two forms only: transparent (primary) and on-stone (fallback plate).
5. **Copy in the kits is written to the voice rules above**, not taken from real
   park marketing, which was not provided.
