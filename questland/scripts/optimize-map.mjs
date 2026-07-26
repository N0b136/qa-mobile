// One-off optimizer for the park map raster. Source master lives untouched in
// content-intake/park-map.png; this writes the app copy to public/assets/.
import sharp from 'sharp'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(__dirname, '../../content-intake/park-map.png')
const outDir = path.resolve(__dirname, '../public/assets')
const out = path.join(outDir, 'park-map.webp')

const meta = await sharp(src).metadata()
console.log(`source: ${meta.width}x${meta.height}, ${(statSync(src).size / 1024 / 1024).toFixed(1)} MB`)

const targetWidth = Math.min(meta.width ?? 2752, 2400)

await sharp(src)
  .resize({ width: targetWidth, withoutEnlargement: true })
  .webp({ quality: 82 })
  .toFile(out)

const outMeta = await sharp(out).metadata()
const outSize = statSync(out).size
console.log(`output: ${outMeta.width}x${outMeta.height}, ${(outSize / 1024 / 1024).toFixed(2)} MB -> ${out}`)
