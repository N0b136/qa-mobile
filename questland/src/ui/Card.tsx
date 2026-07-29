import * as React from 'react';

/**
 * The stone-slab container: 1px gold hairline, 4px radius, 24px padding.
 */
export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  children?: React.ReactNode;
  /** Full-bleed image URL across the top; automatically gets a bottom scrim. */
  image?: string;
  imageAlt?: string;
  imageHeight?: number;
  /**
   * Feathers the hero's four edges away to nothing instead of cutting them
   * square, so whatever is dropped in bleeds into the card rather than sitting
   * on it. Built for parchment — a photograph pasted flat onto vellum reads as
   * a photograph, a feathered one reads as part of the sheet. Suppresses the
   * stone card's bottom scrim, which has nothing left to sit against.
   */
  imageFeather?: boolean;
  /** Small gold uppercase label above the title. */
  eyebrow?: React.ReactNode;
  /** Cinzel caps title. */
  title?: React.ReactNode;
  /** Uppercase meta row at the bottom — separate items with ✦. */
  meta?: React.ReactNode;
  /** Adds hover lift + gold border. Use when the whole card is a link. */
  interactive?: boolean;
  /** parchment switches to hand-torn animal-skin vellum (see the parchment-card handoff). */
  tone?: 'stone' | 'parchment';
  /** Tear variant — different rip per card so repeats look hand-torn. Parchment only. Defaults to `rough`. */
  tear?: 'a' | 'b' | 'c' | 'rough';
  /** Skin hue in deg (--p-hue). 36 default; lower = pinker hide, higher = greener/older. */
  hue?: number;
  /** Skin lightness % (--p-light). 80 default; lower = more tanned. */
  light?: number;
  /** Padding override (--p-pad). Works from a small badge to a full hero panel. */
  pad?: string;
  /** 6px gold-gradient frame with an inner dark line — awards and reveals only. */
  ceremonial?: boolean;
}

/* Torn-edge SVG filters, injected once per page. Procedural — no image files. */
const TEARS: Array<{ id: string; bf: string; oct: number; seed: number; scale: number }> = [
  { id: 'qa-tear-a', bf: '0.012 0.014', oct: 4, seed: 7, scale: 17 },
  { id: 'qa-tear-b', bf: '0.013 0.011', oct: 4, seed: 24, scale: 17 },
  { id: 'qa-tear-c', bf: '0.011 0.015', oct: 4, seed: 42, scale: 18 },
  { id: 'qa-tear-rough', bf: '0.02 0.024', oct: 5, seed: 13, scale: 26 },
];
let tearsInjected = false;
function ensureTearFilters() {
  if (tearsInjected || typeof document === 'undefined' || document.getElementById('qa-tear-defs')) return;
  tearsInjected = true;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('id', 'qa-tear-defs');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute');
  const defs = document.createElementNS(ns, 'defs');
  TEARS.forEach(t => {
    const filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id', t.id);
    filter.setAttribute('x', '-25%'); filter.setAttribute('y', '-25%');
    filter.setAttribute('width', '150%'); filter.setAttribute('height', '150%');
    const turb = document.createElementNS(ns, 'feTurbulence');
    turb.setAttribute('type', 'fractalNoise');
    turb.setAttribute('baseFrequency', t.bf);
    turb.setAttribute('numOctaves', String(t.oct));
    turb.setAttribute('seed', String(t.seed));
    turb.setAttribute('result', 'n');
    const disp = document.createElementNS(ns, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic'); disp.setAttribute('in2', 'n');
    disp.setAttribute('scale', String(t.scale));
    disp.setAttribute('xChannelSelector', 'R'); disp.setAttribute('yChannelSelector', 'G');
    filter.appendChild(turb); filter.appendChild(disp); defs.appendChild(filter);
  });
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

/* Two gradients intersected: the vertical one softens top and bottom, the
   horizontal one the sides, and `intersect` keeps only what both allow — so the
   corners fall away first, the way a wetted edge would. Kept asymmetric top to
   bottom because a hero's bottom edge runs into the title and wants the longer
   fade. -webkit- twin is for Safari, which still names the operator source-in. */
const FEATHER_MASK = [
  'linear-gradient(to bottom, transparent 0%, #000 10%, #000 82%, transparent 100%)',
  'linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%)',
].join(',');

const featherStyle: React.CSSProperties = {
  maskImage: FEATHER_MASK,
  WebkitMaskImage: FEATHER_MASK,
  maskComposite: 'intersect',
  WebkitMaskComposite: 'source-in',
  maskMode: 'alpha',
};

const GRAIN = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.29 0 0 0 0 0.21 0 0 0 0 0.11 0.42 0.42 0.42 0 -0.53'/></filter><rect width='100%' height='100%' filter='url(%23g)'/></svg>\")";

/* The hide: follicle grain, mottled thick/thin patches, edge scorch, base skin tone. */
function vellumBackground(): string {
  return [
    GRAIN,
    'radial-gradient(38% 30% at 22% 26%, hsla(var(--p-hue),30%,42%,.14), transparent 60%)',
    'radial-gradient(30% 44% at 82% 68%, hsla(28,32%,34%,.16), transparent 62%)',
    'radial-gradient(26% 22% at 62% 18%, hsla(var(--p-hue),24%,88%,.5), transparent 55%)',
    'radial-gradient(115% 100% at 50% 50%, transparent 58%, hsla(30,40%,30%,.4) 100%)',
    'linear-gradient(155deg, hsl(var(--p-hue),38%,calc(var(--p-light) * 1%)) 0%, hsl(calc(var(--p-hue) - 4),34%,calc((var(--p-light) - 8) * 1%)) 55%, hsl(calc(var(--p-hue) - 8),32%,calc((var(--p-light) - 16) * 1%)) 100%)',
  ].join(',');
}

/* The stone slab, or — with tone="parchment" — hand-torn animal-skin vellum. */
export function Card({
  children, image, imageAlt = '', imageHeight = 200, imageFeather = false, eyebrow, title, meta,
  interactive = false, tone = 'stone', ceremonial = false,
  tear = 'rough', hue = 36, light = 80, pad, style, ...rest
}: CardProps) {
  const [hover, setHover] = React.useState(false);
  const lift = interactive && hover;
  const parchment = tone === 'parchment';
  React.useEffect(() => { if (parchment) ensureTearFilters(); }, [parchment]);

  // Custom properties (--p-hue/--p-light) aren't in csstype's closed CSSProperties —
  // cast once here rather than sprinkling `as` through every style object below.
  const skinVars = { '--p-hue': hue, '--p-light': light } as React.CSSProperties;

  const padValue = pad || 'var(--space-lg)';

  if (parchment && !ceremonial) {
    const tearId = 'qa-tear-' + tear;
    // A feathered hero bleeds out through the padding so the fade begins at the
    // sheet edge; a square one stays inside it, where a hard edge belongs.
    const heroBleed: React.CSSProperties = imageFeather
      ? {
          marginTop: `calc(${padValue} * -1)`,
          marginLeft: `calc(${padValue} * -1)`,
          marginRight: `calc(${padValue} * -1)`,
          width: `calc(100% + ${padValue} * 2)`,
          ...featherStyle,
        }
      : {};
    const layer: React.CSSProperties = {
      content: '""', position: 'absolute', inset: -7, zIndex: 0,
      borderRadius: 4, pointerEvents: 'none',
    };
    return (
      <div
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative', isolation: 'isolate', margin: 14,
          padding: padValue,
          color: 'var(--text-on-vellum)',
          ...skinVars,
          font: 'var(--body-base)',
          cursor: interactive ? 'pointer' : 'default',
          transform: lift ? 'translateY(-4px) rotate(-.15deg)' : 'none',
          transition: 'transform var(--dur-slow) var(--ease-standard)',
          ...style,
        }}
        {...rest}>
        <div style={{
          ...layer,
          background: vellumBackground(),
          backgroundBlendMode: 'multiply, normal, normal, soft-light, normal, normal',
          filter: 'url(#' + tearId + ') drop-shadow(0 14px 20px rgba(0,0,0,.5))',
        }} />
        <div style={{
          ...layer,
          boxShadow: 'inset 0 0 14px 2px hsla(30,45%,22%,.45)',
          filter: 'url(#' + tearId + ')',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {image ? (
            <img src={image} alt={imageAlt} style={{ width: '100%', height: imageHeight, objectFit: 'cover', display: 'block', marginBottom: 'var(--space-md)', ...heroBleed }} />
          ) : null}
          {eyebrow ? (
            <div style={{
              font: '400 var(--text-xs)/1.2 var(--font-scribe-caps)', letterSpacing: '.22em',
              textTransform: 'uppercase', color: 'var(--text-on-vellum-muted)', marginBottom: '.35rem',
            }}>{eyebrow}</div>
          ) : null}
          {title ? (
            <h3 style={{
              font: '400 var(--text-xl)/1.1 var(--font-scribe)', margin: '0 0 .5rem',
              color: 'var(--text-on-vellum)',
            }}>{title}</h3>
          ) : null}
          {children ? <div style={{ font: 'var(--body-base)', lineHeight: 1.55, color: 'var(--text-on-vellum)' }}>{children}</div> : null}
          {meta ? (
            <div style={{
              marginTop: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)',
              font: '400 var(--text-2xs)/1.2 var(--font-scribe-caps)', letterSpacing: '.18em',
              textTransform: 'uppercase', color: 'var(--text-on-vellum-muted)',
            }}>{meta}</div>
          ) : null}
        </div>
      </div>
    );
  }

  const shell: React.CSSProperties = {
    position: 'relative', overflow: 'hidden',
    borderRadius: 'var(--radius-sm)',
    boxShadow: lift ? 'var(--shadow-lift)' : 'var(--shadow-sm)',
    cursor: interactive ? 'pointer' : 'default',
    transition: 'box-shadow var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)',
  };
  if (ceremonial) {
    shell.backgroundImage = 'var(--gradient-gold)';
    shell.backgroundOrigin = 'border-box';
    shell.border = 'var(--border-frame) solid transparent';
  } else {
    shell.backgroundImage = 'none';
    shell.backgroundColor = 'var(--surface-card)';
    shell.border = '1px solid ' + (lift ? 'var(--border-strong)' : 'var(--border-hairline)');
  }
  const inner: React.CSSProperties | null = ceremonial ? {
    backgroundImage: parchment ? vellumBackground() : 'none',
    backgroundBlendMode: parchment ? 'multiply, normal, normal, soft-light, normal, normal' : undefined,
    backgroundColor: parchment ? 'var(--surface-vellum)' : 'var(--surface-card)',
    border: '1px solid var(--stone-950)',
    color: parchment ? 'var(--text-on-vellum)' : undefined,
  } : null;

  return (
    <div
      className={parchment ? 'qa-on-parchment' : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...shell, ...(parchment ? skinVars : null), ...style }}
      {...rest}>
      <div style={inner || undefined}>
        {image ? (
          <div style={{ position: 'relative', height: imageHeight }}>
            <img src={image} alt={imageAlt} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...(imageFeather ? featherStyle : null) }} />
            {imageFeather ? null : <div style={{ position: 'absolute', inset: 0, background: 'var(--scrim-bottom)' }} />}
          </div>
        ) : null}
        {(eyebrow || title || meta || children) ? (
          <div style={{ padding: padValue }}>
            {eyebrow ? <div className="qa-label" style={{ marginBottom: 'var(--space-xs)' }}>{eyebrow}</div> : null}
            {title ? (
              <h3 style={{
                font: 'var(--title-card)', letterSpacing: 'var(--tracking-display-tight)',
                textTransform: 'uppercase', color: 'var(--text-heading)',
              }}>{title}</h3>
            ) : null}
            {children ? <div style={{ marginTop: title ? 'var(--space-sm)' : 0, font: 'var(--body-base)', color: 'var(--text-muted)' }}>{children}</div> : null}
            {meta ? (
              <div style={{
                marginTop: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)',
                font: 'var(--label-ui)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-muted)',
              }}>{meta}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
