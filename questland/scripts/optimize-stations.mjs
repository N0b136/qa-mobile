// Repeatable optimizer for station card art. Sources live untouched at
// public/assets/stations/st-NN.png (user-supplied masters, 1408x768,
// 2.4-8.6 MB each); this writes sibling st-NN.webp files sized for the
// MapScreen station popup card (dialog maxWidth 420, image fills width,
// object-fit cover) at ~2x — masters are never modified or deleted.
import sharp from 'sharp'
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const stationsDir = path.resolve(__dirname, '../public/assets/stations')

const CARD_WIDTH = 840 // ~2x the 420px dialog max-width

const files = readdirSync(stationsDir)
  .filter((f) => f.endsWith('.png'))
  .sort()

let totalBefore = 0
let totalAfter = 0
const rows = []

for (const file of files) {
  const srcPath = path.join(stationsDir, file)
  const outFile = file.replace(/\.png$/, '.webp')
  const outPath = path.join(stationsDir, outFile)

  const before = statSync(srcPath).size
  totalBefore += before

  await sharp(srcPath)
    .resize({ width: CARD_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80, effort: 6 })
    .toFile(outPath)

  const after = statSync(outPath).size
  totalAfter += after
  rows.push({ file: outFile, before, after })
}

for (const { file, before, after } of rows) {
  console.log(
    `${file}: ${(before / 1024 / 1024).toFixed(2)} MB -> ${(after / 1024).toFixed(0)} KB`,
  )
}
console.log(
  `\nTotal: ${(totalBefore / 1024 / 1024).toFixed(1)} MB -> ${(totalAfter / 1024 / 1024).toFixed(2)} MB`,
)
