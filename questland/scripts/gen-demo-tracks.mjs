// Placeholder music for Questland Radio (src/content/soundtrack.ts) — four
// distinct loops, one per playlist mood, synthesized as 16-bit mono WAV at
// 22050 Hz into public/assets/audio/. Zero deps. Run via `npm run radio:demo`.
//
// Note tails are written modulo the buffer length, so the end wraps into the
// start and every file loops seamlessly — which is why each loop's duration
// must be a whole number of chord-progression passes.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 22050
const TWO_PI = Math.PI * 2

function triangle(phase) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase))
}

/**
 * Renders one loop from a parameterized spec: chord set, tempo (chordDur),
 * arp voicing/register and amp/ring character are all data below.
 */
function renderLoop(spec) {
  const N = SAMPLE_RATE * spec.duration
  const buf = new Float64Array(N)

  // One plucked-harp-ish note: sine fundamental with soft upper partials, a
  // detuned twin for warmth, a whisper of triangle, short attack + long
  // exponential decay. `start` in seconds; the tail wraps around the buffer.
  const addNote = (start, freq, amp, ringDur) => {
    const startSample = Math.floor(start * SAMPLE_RATE)
    const len = Math.floor(ringDur * SAMPLE_RATE)
    const attack = Math.floor(0.03 * SAMPLE_RATE)
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE
      const env = (i < attack ? i / attack : 1) * Math.exp(-2.4 * t)
      const p = TWO_PI * freq * t
      const s =
        Math.sin(p) +
        0.3 * Math.sin(TWO_PI * freq * 1.003 * t) +
        0.22 * Math.sin(2 * p) * Math.exp(-1.6 * t) +
        0.08 * Math.sin(3 * p) * Math.exp(-2.2 * t) +
        0.06 * triangle(p)
      buf[(startSample + i) % N] += amp * env * s
    }
  }

  // Sustained tone with slow attack/release — the pads and the drone.
  const addHold = (start, dur, freq, amp, attackDur, releaseDur, octaveAmp = 0) => {
    const startSample = Math.floor(start * SAMPLE_RATE)
    const len = Math.floor(dur * SAMPLE_RATE)
    const attack = Math.floor(attackDur * SAMPLE_RATE)
    const release = Math.floor(releaseDur * SAMPLE_RATE)
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE
      let env = 1
      if (i < attack) env = i / attack
      if (len - i < release) env = Math.min(env, (len - i) / release)
      const s = Math.sin(TWO_PI * freq * t) + octaveAmp * Math.sin(TWO_PI * freq * 2 * t)
      buf[(startSample + i) % N] += amp * env * s
    }
  }

  const passDur = spec.chordDur * spec.chords.length
  const passes = Math.round(spec.duration / passDur)
  for (let pass = 0; pass < passes; pass++) {
    for (let c = 0; c < spec.chords.length; c++) {
      const chord = spec.chords[c]
      const chordStart = pass * passDur + c * spec.chordDur

      addHold(chordStart, spec.chordDur, chord.root, spec.droneAmp, 0.8, 0.8, spec.droneOct)
      for (const freq of chord.pad) {
        addHold(chordStart, spec.chordDur, freq, spec.padAmp, spec.padAttack, spec.padAttack + 0.2)
      }

      const step = spec.chordDur / chord.arp.length
      chord.arp.forEach((freq, n) => {
        // Alternate passes lift the arpeggio an octave, quieter, for variation.
        const lift = spec.liftAlternate && pass % 2 === 1
        addNote(chordStart + n * step, lift ? freq * 2 : freq, lift ? spec.arpAmp * 0.7 : spec.arpAmp, spec.arpRing)
      })
    }
  }

  // Normalize to a comfortable peak, then quantize to 16-bit PCM.
  let peak = 0
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]))
  const gain = 0.82 / peak
  const pcm = Buffer.alloc(N * 2)
  for (let i = 0; i < N; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * gain)) * 32767), i * 2)
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// The four moods. Durations are whole passes of each progression (see top).
const LOOPS = [
  {
    // The full-park playlist — the original calm A-minor harp (i–VI–III–VII).
    file: 'demo-woods.wav', duration: 44, chordDur: 5.5,
    arpAmp: 0.14, arpRing: 1.6, padAmp: 0.035, padAttack: 1.2,
    droneAmp: 0.13, droneOct: 0.5, liftAlternate: true,
    chords: [
      { root: 55.0, arp: [220.0, 261.63, 329.63, 440.0, 329.63, 261.63], pad: [220.0, 261.63, 329.63] },
      { root: 43.65, arp: [174.61, 220.0, 261.63, 349.23, 261.63, 220.0], pad: [174.61, 220.0, 261.63] },
      { root: 65.41, arp: [261.63, 329.63, 392.0, 523.25, 392.0, 329.63], pad: [261.63, 329.63, 392.0] },
      { root: 49.0, arp: [196.0, 246.94, 293.66, 392.0, 293.66, 246.94], pad: [196.0, 246.94, 293.66] },
    ],
  },
  {
    // Songs of Valor — bolder and lower, at a march tempo (D minor, 8-step arps).
    file: 'demo-valor.wav', duration: 42, chordDur: 3.5,
    arpAmp: 0.17, arpRing: 0.9, padAmp: 0.03, padAttack: 0.6,
    droneAmp: 0.15, droneOct: 0.6, liftAlternate: false,
    chords: [
      { root: 36.71, arp: [146.83, 174.61, 220.0, 293.66, 220.0, 174.61, 146.83, 110.0], pad: [146.83, 174.61, 220.0] },
      { root: 49.0, arp: [196.0, 233.08, 293.66, 392.0, 293.66, 233.08, 196.0, 146.83], pad: [196.0, 233.08, 293.66] },
      { root: 58.27, arp: [233.08, 293.66, 349.23, 466.16, 349.23, 293.66, 233.08, 174.61], pad: [233.08, 293.66, 349.23] },
      { root: 55.0, arp: [220.0, 277.18, 329.63, 440.0, 329.63, 277.18, 220.0, 164.81], pad: [220.0, 277.18, 329.63] },
    ],
  },
  {
    // Airs of the Wilds — A-pentatonic, airy: high soft arps over gentle drones.
    file: 'demo-wilds.wav', duration: 44, chordDur: 5.5,
    arpAmp: 0.09, arpRing: 2.4, padAmp: 0.025, padAttack: 1.6,
    droneAmp: 0.1, droneOct: 0.35, liftAlternate: false,
    chords: [
      { root: 110.0, arp: [440.0, 523.25, 587.33, 659.25, 783.99, 659.25], pad: [220.0, 329.63] },
      { root: 73.42, arp: [587.33, 659.25, 783.99, 880.0, 783.99, 659.25], pad: [293.66, 440.0] },
      { root: 98.0, arp: [392.0, 440.0, 523.25, 587.33, 659.25, 587.33], pad: [196.0, 293.66] },
      { root: 82.41, arp: [329.63, 440.0, 523.25, 659.25, 523.25, 440.0], pad: [164.81, 246.94] },
    ],
  },
  {
    // Hymns of Lore — a slow D-dorian pad: long-breathing holds, sparse notes.
    file: 'demo-lore.wav', duration: 46, chordDur: 5.75,
    arpAmp: 0.07, arpRing: 3.0, padAmp: 0.055, padAttack: 2.0,
    droneAmp: 0.12, droneOct: 0.4, liftAlternate: false,
    chords: [
      { root: 73.42, arp: [293.66, 349.23], pad: [146.83, 174.61, 220.0, 261.63] },
      { root: 49.0, arp: [392.0, 293.66], pad: [196.0, 246.94, 293.66] },
      { root: 55.0, arp: [329.63, 440.0], pad: [220.0, 261.63, 329.63] },
      { root: 65.41, arp: [392.0, 329.63], pad: [261.63, 329.63, 392.0] },
    ],
  },
]

const outDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/assets/audio')
mkdirSync(outDir, { recursive: true })
for (const spec of LOOPS) {
  const wav = renderLoop(spec)
  const outFile = resolve(outDir, spec.file)
  writeFileSync(outFile, wav)
  console.log(`wrote ${outFile} (${(wav.length / 1024 / 1024).toFixed(2)} MB, ${spec.duration}s)`)
}
