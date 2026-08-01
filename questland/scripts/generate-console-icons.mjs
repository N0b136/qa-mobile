// Icons for the Back Office console, which installs as its own home-screen app
// and therefore needs a mark you can tell apart from the guest app at a glance.
//
// Art is the user-supplied flame variant of the Questland lockup — a raster
// master used as-is (DS rule: brand marks are raster assets, never redrawn).
// It reads apart from the guest icon by its fire ring; the two otherwise share
// the same gemstone-Q lockup and the same slate ground.
//
// Master: content-intake/brand/icon-questland-flame.png (1024², full-bleed)
// Output: public/icons/console-*
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const masterPath = path.resolve(__dirname, '../../content-intake/brand/icon-questland-flame.png')
const outDir = path.resolve(__dirname, '../public/icons')

mkdirSync(outDir, { recursive: true })

// Maskable icons are cropped to an unknown shape; only the centre ~80% is
// guaranteed to survive. The master is full-bleed art whose banner runs close
// to the bottom edge, so it is inset rather than cropped — nothing is lost, and
// the gap is filled with the master's own corner rock so the seam disappears.
const SAFE = 0.8

// The emblem alone, banner cropped off, for the browser tab. At 32px the
// wordmark is an unreadable smear; the fire ring still reads as the brand.
const EMBLEM = { left: 172, top: 12, width: 780, height: 780 }

/** Mean of the master's four corners — the flat rock the art already sits on. */
async function sampleCornerFill() {
  const { width, height } = await sharp(masterPath).metadata()
  const size = 60
  const corners = [
    { left: 0, top: 0 },
    { left: width - size, top: 0 },
    { left: 0, top: height - size },
    { left: width - size, top: height - size },
  ]
  const sums = [0, 0, 0]
  for (const { left, top } of corners) {
    // NB: sharp's stats() reads the INPUT image, not the extracted region —
    // it would return the whole-image mean (warm, from the flames). Average
    // the raw pixels instead.
    const { data } = await sharp(masterPath)
      .extract({ left, top, width: size, height: size })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let r = 0
    let g = 0
    let b = 0
    const n = data.length / 3
    for (let i = 0; i < data.length; i += 3) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
    }
    sums[0] += r / n
    sums[1] += g / n
    sums[2] += b / n
  }
  return sums.map((s) => Math.round(s / corners.length))
}

// Palette PNG: ~4x smaller than truecolour on this art and indistinguishable at
// icon scale. These ship inside the guest precache (`includeAssets: icons/*`),
// so weight here is weight on every install.
const png = (pipeline, name) =>
  pipeline.png({ compressionLevel: 9, palette: true }).toFile(path.join(outDir, name))

/** Full-bleed art. iOS and Android both mask this themselves. */
const full = (size) => sharp(masterPath).resize(size, size)

/** Art inset into the maskable safe zone, gap filled with the ground. */
async function maskable(size, [r, g, b]) {
  const inner = Math.round(size * SAFE)
  const offset = Math.round((size - inner) / 2)
  const art = await sharp(masterPath).resize(inner, inner).toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r, g, b } },
  }).composite([{ input: art, left: offset, top: offset }])
}

const fill = await sampleCornerFill()
const written = []

for (const size of [192, 512]) {
  await png(full(size), `console-${size}.png`)
  written.push(`console-${size}.png`)
  await png(await maskable(size, fill), `console-maskable-${size}.png`)
  written.push(`console-maskable-${size}.png`)
}
await png(full(180), 'console-apple-touch-icon.png')
written.push('console-apple-touch-icon.png')
await png(sharp(masterPath).extract(EMBLEM).resize(32, 32), 'console-favicon-32.png')
written.push('console-favicon-32.png')

console.log(`ground rgb(${fill.join(',')}) — wrote ${written.length} files:`)
written.forEach((f) => console.log(`  icons/${f}`))
