// One-off (repeatable) optimizer for brand raster assets in public/assets/.
// Masters live untouched in content-intake/brand/; this rewrites the app
// copies in place, same filenames, alpha preserved.
import sharp from 'sharp'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.resolve(__dirname, '../public/assets')

const targets = [
  { file: 'logo-questland-primary.png', longestSide: 768 },
  { file: 'badge-compass-sword.png', longestSide: 256 },
  { file: 'badge-crowned-tree-gold.png', longestSide: 256 },
  { file: 'relief-pomegranate-tree-stone.png', longestSide: 256 },
]

for (const { file, longestSide } of targets) {
  const filePath = path.join(assetsDir, file)
  const before = statSync(filePath).size

  const buffer = await sharp(filePath)
    .resize({
      width: longestSide,
      height: longestSide,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer()

  await sharp(buffer).toFile(filePath)

  const after = statSync(filePath).size
  console.log(
    `${file}: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`,
  )
}
