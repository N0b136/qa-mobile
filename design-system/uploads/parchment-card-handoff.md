# Parchment Card — Design Handoff

A scalable UI card that looks like animal-skin **vellum with hand-torn edges**. Everything is drawn procedurally (SVG filters + CSS gradients) — no image files — so it scales to any size without blurring, reflows around any content, and never repeats when placed in a grid.

---

## Intent

- **Subject / register:** old-world quest-adventure. The card should read as flayed hide, not die-cut paper.
- **The signature is the torn edge:** irregular, with a darkened worn inner rim and a cast shadow that follows the tear.
- **Content-agnostic:** the skin + tear live on a layer *behind* the content, so text and images inside stay crisp.
- **Reusable everywhere:** one component covers a full hero panel down to a tiny badge, themed per instance via CSS variables.

---

## Design tokens

**Palette (aged vellum on tanned leather)**
| Role | Hex |
|---|---|
| Skin, light centre | `#ece0c4` |
| Skin, tanned edge | `#dccba0` → `#b89b6a` |
| Edge scorch / aging | `#8a6d43` |
| Ink (text) | `#3b2a16` |
| Wax-seal accent (optional) | `#7a2e22` |
| Backdrop (deep leather) | `#241a12` |

**Type**
- Display: **IM Fell English** (17th-c. letterpress face, inked-into-page wobble)
- Small-caps labels: **IM Fell English SC**
- Body: **EB Garamond**

**Per-card knobs (CSS custom properties)**
- `--p-hue` — skin hue in deg (default `36`; lower = pinker hide, higher = greener/older)
- `--p-light` — skin lightness % (default `80`; lower = darker/more tanned)
- `--p-ink` — text colour (default `#3b2a16`)
- `--p-pad` — padding (default `2.6rem`; works from a badge to a full panel)

**Tear variants (swap the class)**
- `tear-a` / `tear-b` / `tear-c` — same roughness, different rip, so repeats look hand-torn
- `tear-rough` — heavier, more shredded edge

---

## Component code (minimal, production-ready)

Paste the `<svg>` filter block **once per page**; it's invisible. Then use `<div class="parchment tear-a">…</div>` anywhere.

```html
<!-- Torn-edge filters: paste once per page. Invisible. -->
<svg width="0" height="0" aria-hidden="true" style="position:absolute">
  <defs>
    <filter id="tear-a" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.014" numOctaves="4" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="17" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="tear-b" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.013 0.011" numOctaves="4" seed="24" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="17" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="tear-c" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.011 0.015" numOctaves="4" seed="42" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="18" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="tear-rough" x="-25%" y="-25%" width="150%" height="150%">
      <feTurbulence type="fractalNoise" baseFrequency="0.02 0.024" numOctaves="5" seed="13" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>

<div class="parchment tear-a">
  <p class="kicker">Field Notice</p>
  <h2>The Cartographer's Guild</h2>
  <p>Any markup goes here — headings, text, images, buttons. The skin reflows around it and the edges stay torn at any size.</p>
</div>
```

```css
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=swap');

.parchment{
  --p-pad:2.6rem;
  --p-ink:#3b2a16;
  --p-hue:36;
  --p-light:80;

  position:relative;
  isolation:isolate;
  padding:var(--p-pad);
  margin:14px;                       /* room for the ragged overhang */
  color:var(--p-ink);
  font-family:"EB Garamond",Georgia,serif;
  font-size:1.05rem;
  line-height:1.55;
}

/* the hide: gradients + soft grain, displaced into a torn shape behind content */
.parchment::before{
  content:"";
  position:absolute;
  inset:-7px;
  z-index:-1;
  border-radius:4px;
  background:
    /* soft follicle grain */
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.29 0 0 0 0 0.21 0 0 0 0 0.11 0.42 0.42 0.42 0 -0.53'/></filter><rect width='100%' height='100%' filter='url(%23g)'/></svg>"),
    /* mottled thick/thin patches */
    radial-gradient(38% 30% at 22% 26%, hsla(var(--p-hue),30%,42%,.14), transparent 60%),
    radial-gradient(30% 44% at 82% 68%, hsla(28,32%,34%,.16), transparent 62%),
    radial-gradient(26% 22% at 62% 18%, hsla(var(--p-hue),24%,88%,.5), transparent 55%),
    /* edge scorch / vignette */
    radial-gradient(115% 100% at 50% 50%, transparent 58%, hsla(30,40%,30%,.4) 100%),
    /* base skin tone */
    linear-gradient(155deg,
      hsl(var(--p-hue),38%,calc(var(--p-light) * 1%)) 0%,
      hsl(calc(var(--p-hue) - 4),34%,calc((var(--p-light) - 8) * 1%)) 55%,
      hsl(calc(var(--p-hue) - 8),32%,calc((var(--p-light) - 16) * 1%)) 100%);
  background-blend-mode:multiply, normal, normal, soft-light, normal, normal;
  filter:url(#tear-a) drop-shadow(0 14px 20px rgba(0,0,0,.5));
}

/* worn inner rim — a thinned, flayed edge that hugs the tear */
.parchment::after{
  content:"";
  position:absolute;
  inset:-7px;
  z-index:-1;
  border-radius:4px;
  box-shadow:inset 0 0 14px 2px hsla(30,45%,22%,.45);
  filter:url(#tear-a);
  pointer-events:none;
}

/* tear variants: different rip per card */
.tear-b::before{filter:url(#tear-b) drop-shadow(0 14px 20px rgba(0,0,0,.5));}
.tear-b::after{filter:url(#tear-b);}
.tear-c::before{filter:url(#tear-c) drop-shadow(0 14px 20px rgba(0,0,0,.5));}
.tear-c::after{filter:url(#tear-c);}
.tear-rough::before{filter:url(#tear-rough) drop-shadow(0 16px 22px rgba(0,0,0,.55));}
.tear-rough::after{filter:url(#tear-rough);}

/* optional hover lift */
.parchment{transition:transform .35s ease;}
@media (hover:hover){ .parchment:hover{transform:translateY(-4px) rotate(-.15deg);} }
@media (prefers-reduced-motion:reduce){ .parchment{transition:none;} .parchment:hover{transform:none;} }

/* in-card type helpers */
.parchment h2,.parchment h3{font-family:"IM Fell English",serif;font-weight:400;margin:0 0 .5rem;}
.parchment h2{font-size:1.9rem;line-height:1.1;}
.parchment .kicker{font-family:"IM Fell English SC",serif;text-transform:uppercase;letter-spacing:.22em;font-size:.72rem;color:#6a4a24;margin:0 0 .35rem;}
```

**Tuning notes**
- Grain: the `-0.53` in the grain `feColorMatrix` is the threshold — more negative = fewer flecks (smoother); `baseFrequency='1.4'` is fineness. Delete the whole `url("data:image/svg+xml…")` line (and its `multiply` in `background-blend-mode`) for zero speckle.
- Tear: `scale=` on the displacement = how violent the rip; `baseFrequency=` = coarse vs. fine fray; `seed=` = a different rip. Duplicate a `<filter>` with a new `seed` for more variety.
- Perf: `feDisplacementMap` is heavier than a flat image — great for a handful of cards, avoid hundreds on one screen.

---

## Paste-ready prompt for Claude Design

> Build a reusable "parchment card" component — animal-skin vellum with hand-torn edges, drawn entirely with CSS + SVG filters (no image files) so it scales cleanly and reflows around any content.
>
> Palette: skin `#ece0c4` fading to tanned `#b89b6a` at the edges, edge scorch `#8a6d43`, sepia ink `#3b2a16`, optional oxblood wax-seal accent `#7a2e22`, on a deep leather backdrop `#241a12`. Type: IM Fell English for display, IM Fell English SC for small-caps labels, EB Garamond for body.
>
> The torn edge is the signature: apply an SVG feTurbulence + feDisplacementMap filter to a `::before` layer holding the hide texture (layered gradients for mottled thick/thin patches + a very soft grain), so the content on top stays crisp. Add a darkened worn inner rim and a shadow that follows the tear. Give each card a different filter seed so repeats look hand-torn. Expose CSS variables `--p-hue`, `--p-light`, `--p-ink`, `--p-pad` for per-card theming, and tear variants `tear-a/b/c/rough`.
>
> Show it at three sizes — a hero panel, two medium cards in a row, and small badges — to prove it scales. (Reference component code is provided above; match its look, keep the grain subtle.)
