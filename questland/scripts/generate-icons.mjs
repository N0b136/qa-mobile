// Repeatable icon generator. Sources the finished master art (full gemstone-Q
// lockup + banner, already composited on dark slate/rock — no further
// compositing needed) and derives every PWA/iOS icon size from it.
//
// Master: content-intake/icon-rock-bg.png (2000x2000, opaque RGB)
// Output: public/icons/*
import sharp from 'sharp'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const masterPath = path.resolve(__dirname, '../../content-intake/icon-rock-bg.png')
const outDir = path.resolve(__dirname, '../public/icons')

mkdirSync(outDir, { recursive: true })

// The old SVG favicon is fully superseded by the PNG favicons below.
const stalePath = path.join(outDir, 'sigil.svg')
if (existsSync(stalePath)) rmSync(stalePath)

// Sample the master's own corner slate so the maskable safe-zone fill reads
// as a seamless continuation of the art rather than a mismatched patch.
async function sampleCornerFill() {
  const size = 60
  const corners = [
    { left: 0, top: 0 },
    { left: 2000 - size, top: 0 },
    { left: 0, top: 2000 - size },
    { left: 2000 - size, top: 2000 - size },
  ]
  const sums = [0, 0, 0]
  for (const { left, top } of corners) {
    const { data } = await sharp(masterPath)
      .extract({ left, top, width: size, height: size })
      .raw()
      .toBuffer({ resolveWithObject: true })
    let r = 0, g = 0, b = 0
    const n = data.length / 3
    for (let i = 0; i < data.length; i += 3) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]
    }
    sums[0] += r / n
    sums[1] += g / n
    sums[2] += b / n
  }
  return {
    r: Math.round(sums[0] / corners.length),
    g: Math.round(sums[1] / corners.length),
    b: Math.round(sums[2] / corners.length),
    alpha: 1,
  }
}

async function writeAnyIcon(size) {
  const file = `icon-${size}.png`
  await sharp(masterPath).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(outDir, file))
  return file
}

async function writeMaskableIcon(size, fill) {
  const file = `icon-maskable-${size}.png`
  const artSize = Math.round(size * 0.8) // ~10% margin each side — safe zone for circular/squircle masks
  const art = await sharp(masterPath).resize(artSize, artSize).toBuffer()
  await sharp({ create: { width: size, height: size, channels: 3, background: fill } })
    .composite([{ input: art, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, file))
  return file
}

async function writeAppleTouchIcon() {
  const file = 'apple-touch-icon.png'
  // iOS rounds the corners itself — ship the full opaque master, no padding.
  await sharp(masterPath).resize(180, 180).png({ compressionLevel: 9 }).toFile(path.join(outDir, file))
  return file
}

// At 16-32px the full lockup (ring + banner text) goes muddy. Center-crop to
// just the gemstone-Q roundel — measured against the 2000x2000 master, this
// box holds the ring/gem art and stops just above the "QUESTLAND" ribbon.
const FAVICON_CROP = { left: 350, top: 20, width: 1300, height: 1300 }

async function writeFavicon(size) {
  const file = `favicon-${size}.png`
  await sharp(masterPath)
    .extract(FAVICON_CROP)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, file))
  return file
}

const fill = await sampleCornerFill()
console.log(`Sampled maskable safe-zone fill: rgb(${fill.r}, ${fill.g}, ${fill.b})`)

const written = []
written.push(await writeAnyIcon(192))
written.push(await writeAnyIcon(512))
written.push(await writeMaskableIcon(192, fill))
written.push(await writeMaskableIcon(512, fill))
written.push(await writeAppleTouchIcon())
written.push(await writeFavicon(32))
written.push(await writeFavicon(16))

console.log(`Wrote ${written.length} icons to ${path.relative(process.cwd(), outDir)}:`)
for (const file of written) console.log(`  - ${file}`)
