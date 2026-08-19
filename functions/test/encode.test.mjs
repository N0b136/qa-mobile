// Proves the ffmpeg argument strings and the naming rules without a bucket,
// a project, or a deploy. Run: npm run radio:test
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FFMPEG, FFPROBE, encode, measure, probeDuration, routeDrop, sha256, slugify, titleFrom,
} from '../lib/radioEncode.js'

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

// Before anything else: is there actually an ffmpeg to run? A missing binary
// otherwise surfaces as a raw ENOENT from deep inside measure(), which reads
// like a code fault rather than an install one.
console.log('— binaries —')
check('ffmpeg binary is present', existsSync(FFMPEG), true)
check('ffprobe binary is present', existsSync(FFPROBE), true)
if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) {
  console.log('\nffmpeg/ffprobe missing — run `npm install` in functions/ and try again.')
  process.exit(1)
}

console.log('— naming —')
check('apostrophe survives the title', titleFrom("Aldric's Way.mp3"), "Aldric's Way")
check('punctuation survives', titleFrom('Hear Us, We Hear — Instrumental.wav'), 'Hear Us, We Hear — Instrumental')
check('slug of an apostrophe title', slugify("Aldric's Way"), 'aldric-s-way')
check('slug strips accents', slugify('Café Réverie'), 'cafe-reverie')
check('slug collapses junk', slugify('  ***Song!! (Final)  '), 'song-final')
check('slug drops the em dash', slugify('Hear Us — Instrumental'), 'hear-us-instrumental')
check('unusable name yields empty slug', slugify('!!!'), '')

console.log('\n— the loop guard —')
const refused = (n) => { const r = routeDrop(n); return r.take ? 'TAKEN' : r.reason }
check('encoded output is refused', refused('radio/song.m4a'), 'outside the inbox')
check('a filed source is refused', refused('inbox/_done/song.mp3'), 'already filed')
check('a duplicate-filed source is refused', refused('inbox/_done/duplicate/song.mp3'), 'already filed')
check('some other object is refused', refused('assets/logo.png'), 'outside the inbox')
check('a folder placeholder is refused', refused('inbox/valor/'), 'folder placeholder')
check('a stray text file is refused', refused('inbox/notes.txt'), 'unsupported extension .txt')

console.log('\n— shelving —')
const plan = (n) => { const r = routeDrop(n); return r.take ? { id: r.trackId, out: r.outPath, pl: r.playlistIds, unsorted: r.unsorted, title: r.title } : r.reason }
check("valor drop", plan("inbox/valor/Aldric's Way.mp3"),
  { id: 'trk-aldric-s-way', out: 'radio/aldric-s-way.m4a', pl: ['pl-woods', 'pl-valor'], unsorted: false, title: "Aldric's Way" })
check('hearers alias maps to wilds', plan('inbox/hearers/Hear Us.wav').pl, ['pl-woods', 'pl-wilds'])
check('realm alias maps to lore', plan('inbox/realm/Anthem.flac').pl, ['pl-woods', 'pl-lore'])
check('folder case is ignored', plan('inbox/VALOR/Song.mp3').pl, ['pl-woods', 'pl-valor'])
check('root drop is unsorted', plan('inbox/Loose Song.mp3'), 
  { id: 'trk-loose-song', out: 'radio/loose-song.m4a', pl: ['pl-woods'], unsorted: true, title: 'Loose Song' })
check('kingdom is a decision, not unsorted', plan('inbox/kingdom/Medley.mp3').unsorted, false)
check('unknown folder is unsorted', plan('inbox/misc/Song.mp3').unsorted, true)
check('nested path still routes', plan('inbox/valor/2026/Song.mp3').pl, ['pl-woods', 'pl-valor'])

const dir = mkdtempSync(join(tmpdir(), 'radio-test-'))
try {
  console.log('\n— two-pass encode —')
  const src = join(dir, 'tone.wav')
  const out = join(dir, 'tone.m4a')
  const gen = spawnSync(FFMPEG, ['-y','-hide_banner','-nostats','-f','lavfi','-i','sine=frequency=440:duration=7','-ar','44100','-ac','2', src])
  check('generated a source', gen.status, 0)

  const m = await measure(src)
  console.log(`  measured I=${m.input_i} TP=${m.input_tp} LRA=${m.input_lra} thresh=${m.input_thresh} offset=${m.target_offset}`)
  check('measure returns all five fields',
    ['input_i','input_tp','input_lra','input_thresh','target_offset'].every((k) => typeof m[k] === 'string'), true)

  await encode(src, out, m)
  check('encoded file exists', existsSync(out), true)
  check('probed duration', await probeDuration(out), 7)

  const p = spawnSync(FFPROBE, ['-v','error','-select_streams','a:0','-show_entries','stream=codec_name,sample_rate,channels','-of','default=noprint_wrappers=1', out], { encoding: 'utf8' })
  console.log('  ' + p.stdout.trim().split('\n').join('  '))
  check('codec is aac', /codec_name=aac/.test(p.stdout), true)
  check('44.1 kHz', /sample_rate=44100/.test(p.stdout), true)
  check('stereo', /channels=2/.test(p.stdout), true)
  console.log(`  encoded size: ${statSync(out).size} bytes`)

  console.log('\n— hashing —')
  const h1 = await sha256(src)
  const h2 = await sha256(src)
  check('hash is stable', h1 === h2, true)
  check('hash is sha256-shaped', /^[0-9a-f]{64}$/.test(h1), true)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`)
process.exit(fails ? 1 : 0)
