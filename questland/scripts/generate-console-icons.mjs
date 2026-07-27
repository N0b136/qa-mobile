// Icons for the Back Office console, which installs as its own home-screen app
// and therefore needs a mark you can tell apart from the guest app at a glance.
//
// It deliberately does NOT reuse or redraw the Questland brand lockup (DS rule:
// brand marks are raster assets, never redrawn). Instead it follows the DS the
// same way any other staff surface does — the master icon's own slate ground,
// with the Warden's shield from the Lucide glyph vocabulary struck in guild
// gold. Placeholder-grade on purpose: swap in real art by replacing this.
//
// Ground: sampled from content-intake/icon-rock-bg.png corners (same family)
// Output: public/icons/console-*
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const masterPath = path.resolve(__dirname, '../../content-intake/icon-rock-bg.png')
const outDir = path.resolve(__dirname, '../public/icons')

mkdirSync(outDir, { recursive: true })

const GOLD = '#D0AC6E' // --gold-400, the brighter step — small sizes need the contrast
const SHIELD =
  'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'

// Same corner-sampling the main generator uses, so both icons sit on identical
// slate and read as one family.
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

/**
 * @param size    output edge in px
 * @param cover   fraction of the edge the shield spans. Maskable icons keep it
 *                inside the ~80% safe zone so a circular mask cannot clip it.
 */
function iconSvg(size, [r, g, b], cover) {
  const glyph = size * cover
  const offset = (size - glyph) / 2
  const scale = glyph / 24
  // Constant visual stroke weight regardless of output size. Heavier than a DS
  // hairline on purpose — a home-screen icon renders around 48px, where a true
  // hairline disappears.
  const stroke = 2.1 / scale
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="rgb(${r},${g},${b})"/>
      <g transform="translate(${offset} ${offset}) scale(${scale})">
        <path d="${SHIELD}" fill="none" stroke="${GOLD}" stroke-width="${stroke}"
              stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </svg>`
  )
}

const write = (name, svg) =>
  sharp(svg).png({ compressionLevel: 9 }).toFile(path.join(outDir, name))

const fill = await sampleCornerFill()
const written = []

for (const size of [192, 512]) {
  await write(`console-${size}.png`, iconSvg(size, fill, 0.56))
  written.push(`console-${size}.png`)
  await write(`console-maskable-${size}.png`, iconSvg(size, fill, 0.42))
  written.push(`console-maskable-${size}.png`)
}
await write('console-apple-touch-icon.png', iconSvg(180, fill, 0.56))
written.push('console-apple-touch-icon.png')
await write('console-favicon-32.png', iconSvg(32, fill, 0.66))
written.push('console-favicon-32.png')

console.log(`ground rgb(${fill.join(',')}) — wrote ${written.length} files:`)
written.forEach((f) => console.log(`  icons/${f}`))
