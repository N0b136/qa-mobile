// Throwaway coordinate-verification tool. Composites small numbered dots onto
// the full-res source map at the fractions below, so they can be visually
// checked against the printed station labels/art. Not wired into the app.
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(__dirname, '../../content-intake/park-map.png')
const outDir = process.argv[2] || path.resolve(__dirname, '../../scratch')
mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, 'map-check.png')

// x,y as 0..1 fractions of the image. Keys = printed number on the map.
const STATION_COORDS = {
  '01': { x: 0.079, y: 0.262 },
  '02': { x: 0.215, y: 0.305 },
  '03': { x: 0.309, y: 0.3 },
  '04': { x: 0.235, y: 0.502 },
  '05': { x: 0.115, y: 0.627 },
  '06': { x: 0.448, y: 0.309 },
  '07': { x: 0.575, y: 0.287 },
  '08': { x: 0.389, y: 0.554 },
  '09': { x: 0.7, y: 0.842 },
  10: { x: 0.543, y: 0.82 },
  11: { x: 0.279, y: 0.775 },
  12: { x: 0.505, y: 0.555 },
  13: { x: 0.687, y: 0.625 },
  14: { x: 0.619, y: 0.699 },
  // 15 is synthetic, not drawn on the map — verified separately.
  16: { x: 0.675, y: 0.535 },
  17: { x: 0.81, y: 0.488 },
  18: { x: 0.938, y: 0.547 },
  19: { x: 0.715, y: 0.358 },
  20: { x: 0.815, y: 0.712 },
  21: { x: 0.915, y: 0.873 },
}

const LANDMARKS = {
  village: { x: 0.818, y: 0.143 },
  hall: { x: 0.939, y: 0.206 },
  tavern: { x: 0.792, y: 0.202 },
  parking: { x: 0.89, y: 0.345 },
  gate: { x: 0.781, y: 0.318 },
}

const meta = await sharp(src).metadata()
const W = meta.width
const H = meta.height

function dotsSvg(coords, color, r) {
  return Object.entries(coords)
    .map(([label, { x, y }]) => {
      const cx = x * W
      const cy = y * H
      return `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="0.85" stroke="#000" stroke-width="3" />
      <text x="${cx}" y="${cy + 7}" font-size="26" font-weight="700" text-anchor="middle" fill="#000">${label}</text>
    `
    })
    .join('\n')
}

const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${dotsSvg(STATION_COORDS, '#ff2d55', 22)}
  ${dotsSvg(LANDMARKS, '#2dc7ff', 18)}
</svg>
`

await sharp(src)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png()
  .toFile(out)

console.log(`wrote ${out} (${W}x${H})`)
