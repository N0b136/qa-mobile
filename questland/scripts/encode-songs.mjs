// Questland Radio encoder — turns a folder of source songs into web-ready
// AAC tracks (two-pass EBU R128 loudness normalization + faststart .m4a),
// plus a ready-to-paste TypeScript block for src/content/soundtrack.ts.
// Zero deps. Run via `npm run radio:encode -- <inputDir> [flags]`.
//
// Requires ffmpeg + ffprobe on PATH. Always invoked via spawnSync with array
// args (never a shell string) so spaces in Windows paths are never an issue.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..') // qa-mobile/

const INPUT_EXTS = new Set(['.mp3', '.wav', '.flac', '.aiff', '.aif', '.m4a', '.ogg'])
const LOSSY_EXTS = new Set(['.mp3', '.m4a', '.ogg'])

// ---------------------------------------------------------------------------
// Argument parsing

function usage() {
  console.log(`Usage: node scripts/encode-songs.mjs <inputDir> [options]

Options:
  --out <dir>        Output directory (default: <inputDir>/../radio-encoded)
  --bitrate <rate>   AAC bitrate, e.g. 128k (default: 128k)
  --lufs <n>          Target integrated loudness in LUFS (default: -16)
  --no-normalize      Skip the two-pass loudness normalization
  --dry-run           List planned output without running ffmpeg
  --help              Show this help
`)
}

function parseArgs(argv) {
  const args = { out: null, bitrate: '128k', lufs: -16, normalize: true, dryRun: false, help: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--out':
        args.out = argv[++i]
        break
      case '--bitrate':
        args.bitrate = argv[++i]
        break
      case '--lufs':
        args.lufs = Number(argv[++i])
        break
      case '--no-normalize':
        args.normalize = false
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        if (a.startsWith('--')) {
          console.error(`Unknown flag: ${a}`)
          process.exit(1)
        }
        positional.push(a)
    }
  }
  args.inputDir = positional[0]
  return args
}

// ---------------------------------------------------------------------------
// ffmpeg / ffprobe presence

function requireFfmpeg() {
  const ffmpegOk = spawnSync('ffmpeg', ['-version']).error === undefined
  const ffprobeOk = spawnSync('ffprobe', ['-version']).error === undefined
  if (ffmpegOk && ffprobeOk) return

  console.error('\nffmpeg and/or ffprobe were not found on PATH.\n')
  console.error('Install it for your platform:')
  console.error('  Windows : winget install Gyan.FFmpeg    (or: choco install ffmpeg)')
  console.error('  macOS   : brew install ffmpeg')
  console.error('  Linux   : sudo apt install ffmpeg')
  console.error(`\n(this run detected platform: ${process.platform})`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Small helpers

function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function titleCase(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function naturalSort(files) {
  return [...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// ffmpeg invocations (two-pass EBU R128 loudnorm, then AAC encode)

function runLoudnormMeasure(inputPath, lufs) {
  const filter = `loudnorm=I=${lufs}:TP=-1.5:LRA=11:print_format=json`
  const res = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', inputPath, '-af', filter, '-f', 'null', '-'], {
    encoding: 'utf8',
  })
  if (res.error) throw new Error(`ffmpeg (measure pass) failed to launch: ${res.error.message}`)
  const stderr = res.stderr || ''
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`could not find loudnorm measurement in ffmpeg output:\n${stderr.slice(-800)}`)
  }
  let measured
  try {
    measured = JSON.parse(stderr.slice(start, end + 1))
  } catch {
    throw new Error(`could not parse loudnorm measurement JSON:\n${stderr.slice(start, end + 1)}`)
  }
  if (res.status !== 0) {
    throw new Error(`ffmpeg (measure pass) exited ${res.status}:\n${stderr.slice(-800)}`)
  }
  return measured
}

function encode(inputPath, outputPath, { bitrate, lufs, normalize, measured }) {
  const args = ['-y', '-hide_banner', '-nostats', '-i', inputPath]
  if (normalize) {
    const filter =
      `loudnorm=I=${lufs}:TP=-1.5:LRA=11:` +
      `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
      `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:` +
      `offset=${measured.target_offset}:linear=true:print_format=summary`
    args.push('-af', filter)
  }
  args.push(
    '-map_metadata', '-1', // strip metadata bloat
    '-c:a', 'aac',
    '-b:a', bitrate,
    '-ar', '44100',
    '-ac', '2',
    '-vn', // drop video/attached-artwork streams
    '-movflags', '+faststart',
    outputPath,
  )
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  if (res.error) throw new Error(`ffmpeg (encode) failed to launch: ${res.error.message}`)
  if (res.status !== 0) throw new Error(`ffmpeg (encode) exited ${res.status}:\n${(res.stderr || '').slice(-800)}`)
}

function probeOutput(outputPath) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', outputPath], {
    encoding: 'utf8',
  })
  if (res.error) throw new Error(`ffprobe failed to launch: ${res.error.message}`)
  if (res.status !== 0) throw new Error(`ffprobe exited ${res.status}:\n${(res.stderr || '').slice(-800)}`)
  let info
  try {
    info = JSON.parse(res.stdout)
  } catch {
    throw new Error(`could not parse ffprobe output:\n${res.stdout.slice(-800)}`)
  }
  const audioStream = (info.streams || []).find((s) => s.codec_type === 'audio')
  if (!audioStream) throw new Error('ffprobe found no audio stream in output')
  const duration = Math.round(Number(info.format?.duration ?? audioStream.duration ?? 0))
  return { duration, codec: audioStream.codec_name }
}

// ---------------------------------------------------------------------------
// Main

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.inputDir) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const inputDir = path.resolve(process.cwd(), args.inputDir)
  if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
    console.error(`Input directory not found: ${inputDir}`)
    process.exit(1)
  }

  if (!Number.isFinite(args.lufs)) {
    console.error(`--lufs must be a number, got: ${args.lufs}`)
    process.exit(1)
  }

  const outDir = args.out ? path.resolve(process.cwd(), args.out) : path.resolve(inputDir, '..', 'radio-encoded')

  const normalizedRepoRoot = REPO_ROOT.toLowerCase()
  const normalizedOutDir = path.resolve(outDir).toLowerCase()
  if (normalizedOutDir === normalizedRepoRoot || normalizedOutDir.startsWith(normalizedRepoRoot + path.sep)) {
    console.log('=' .repeat(70))
    console.log('WARNING: output directory is INSIDE this repository, which is PUBLIC.')
    console.log(`  ${outDir}`)
    console.log('Songs must not be committed. Use --out to point outside the repo,')
    console.log('or move the encoded files out before committing anything.')
    console.log('='.repeat(70))
  }

  if (!args.dryRun) requireFfmpeg()

  const allFiles = naturalSort(
    readdirSync(inputDir).filter((f) => INPUT_EXTS.has(path.extname(f).toLowerCase())),
  )

  if (allFiles.length === 0) {
    console.error(`No input files found in ${inputDir}`)
    console.error(`(looked for: ${[...INPUT_EXTS].join(', ')})`)
    process.exit(1)
  }

  const hasLossyInput = allFiles.some((f) => LOSSY_EXTS.has(path.extname(f).toLowerCase()))
  if (hasLossyInput) {
    console.log('!'.repeat(70))
    console.log('WARNING: some inputs are lossy (.mp3/.m4a/.ogg). Re-encoding')
    console.log('lossy -> lossy stacks generation loss. Prefer WAV/FLAC masters if')
    console.log('you have them.')
    console.log('!'.repeat(70))
  }

  console.log(`Input : ${inputDir}  (${allFiles.length} file${allFiles.length === 1 ? '' : 's'})`)
  console.log(`Output: ${outDir}`)
  console.log(`Bitrate: ${args.bitrate}  LUFS target: ${args.lufs}  Normalize: ${args.normalize ? 'yes (two-pass)' : 'no'}`)
  console.log('')

  const pad = Math.max(2, String(allFiles.length).length)
  const plan = allFiles.map((file, i) => {
    const base = path.basename(file, path.extname(file))
    const slug = slugify(base) || `track-${i + 1}`
    const index = String(i + 1).padStart(pad, '0')
    return {
      index,
      srcFile: file,
      srcPath: path.join(inputDir, file),
      slug,
      outFile: `${index}-${slug}.m4a`,
    }
  })

  if (args.dryRun) {
    console.log('[dry run] would produce:')
    for (const p of plan) {
      console.log(`  ${p.srcFile}  ->  ${p.outFile}`)
    }
    console.log(`\n[dry run] no ffmpeg invoked, no files written.`)
    return
  }

  mkdirSync(outDir, { recursive: true })

  const results = []
  const failures = []

  for (const p of plan) {
    const outputPath = path.join(outDir, p.outFile)
    try {
      let measured = null
      if (args.normalize) {
        measured = runLoudnormMeasure(p.srcPath, args.lufs)
      }
      encode(p.srcPath, outputPath, { bitrate: args.bitrate, lufs: args.lufs, normalize: args.normalize, measured })
      const probe = probeOutput(outputPath)
      const size = statSync(outputPath).size

      const loudnessNote = args.normalize
        ? `measured ${Number(measured.input_i).toFixed(1)} LUFS -> target ${args.lufs} LUFS`
        : 'normalization skipped'

      console.log(
        `${p.srcFile} -> ${p.outFile}  |  ${formatDuration(probe.duration)} (${probe.duration}s)  |  ${formatBytes(size)}  |  ${probe.codec}  |  ${loudnessNote}`,
      )

      results.push({ ...p, duration: probe.duration, size, codec: probe.codec, title: titleCase(p.slug) })
    } catch (err) {
      console.error(`FAILED: ${p.srcFile}: ${err.message}`)
      failures.push({ file: p.srcFile, error: err.message })
    }
  }

  if (results.length > 0) {
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
    const totalBytes = results.reduce((sum, r) => sum + r.size, 0)
    const avgBitrateKbps = totalDuration > 0 ? Math.round((totalBytes * 8) / totalDuration / 1000) : 0

    console.log('')
    console.log(`Total duration : ${formatDuration(totalDuration)} (${totalDuration}s)`)
    console.log(`Total size     : ${formatBytes(totalBytes)}`)
    console.log(`Average bitrate: ~${avgBitrateKbps} kbps`)

    // Slugs (and therefore the naive 'trk-<slug>' id) can collide across a
    // real batch — e.g. "Theme (Reprise)" and "Theme [Reprise]" both slugify
    // to "theme-reprise". The NN index is already unique, so on collision we
    // suffix every entry sharing that slug with its index to keep ids unique.
    const slugCounts = {}
    for (const r of results) slugCounts[r.slug] = (slugCounts[r.slug] || 0) + 1
    const idFor = (r) => (slugCounts[r.slug] > 1 ? `trk-${r.slug}-${r.index}` : `trk-${r.slug}`)

    const collidedSlugs = Object.keys(slugCounts).filter((s) => slugCounts[s] > 1)
    if (collidedSlugs.length > 0) {
      for (const slug of collidedSlugs) {
        const files = results.filter((r) => r.slug === slug).map((r) => r.srcFile)
        console.log(
          `NOTE: ${files.length} files slugified to "${slug}" (${files.join(', ')}) — ids disambiguated with an index suffix; consider clearer titles.`,
        )
      }
    }

    const entries = results
      .map(
        (r) =>
          `  {\n    id: '${idFor(r)}',\n    title: '${r.title.replace(/'/g, "\\'")}',\n    duration: ${r.duration},\n    source: { kind: 'storage', path: 'radio/${r.outFile}' },\n  },`,
      )
      .join('\n')
    const tsBlock =
      `// Paste into TRACKS in questland/src/content/soundtrack.ts — titles are a\n` +
      `// starting point, edit for voice. Generated by scripts/encode-songs.mjs.\n` +
      entries +
      '\n'

    console.log('\n--- RadioTrack entries (paste into src/content/soundtrack.ts) ---\n')
    console.log(tsBlock)

    const entriesPath = path.join(outDir, 'soundtrack-entries.ts.txt')
    writeFileSync(entriesPath, tsBlock)
    console.log(`(also written to ${entriesPath})`)
  }

  if (failures.length > 0) {
    console.log('')
    console.log(`${failures.length} of ${plan.length} file(s) failed:`)
    for (const f of failures) console.log(`  - ${f.file}: ${f.error}`)
    process.exitCode = 1
  }
}

main()
