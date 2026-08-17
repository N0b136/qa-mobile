// Placeholder music for the lock-screen audio spike (RadioSpikeScreen).
// Synthesizes a slow A-minor arpeggio over a low drone — 16-bit mono WAV,
// 22050 Hz, ~72 s — into public/assets/audio/radio-spike.wav. Zero deps.
//
// Note tails are written modulo the buffer length, so the end wraps into the
// start and the file loops seamlessly.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 22050
const DURATION = 72 // s — 4 passes of a 4-chord, 18 s progression
const N = SAMPLE_RATE * DURATION
const TWO_PI = Math.PI * 2

// i–VI–III–VII in A minor. Each chord: a drone root (A1/F1/C2/G1 region),
// six arpeggiated tones (up and back down), and three pad tones held under.
const CHORDS = [
  { root: 55.0, arp: [220.0, 261.63, 329.63, 440.0, 329.63, 261.63], pad: [220.0, 261.63, 329.63] },
  { root: 43.65, arp: [174.61, 220.0, 261.63, 349.23, 261.63, 220.0], pad: [174.61, 220.0, 261.63] },
  { root: 65.41, arp: [261.63, 329.63, 392.0, 523.25, 392.0, 329.63], pad: [261.63, 329.63, 392.0] },
  { root: 49.0, arp: [196.0, 246.94, 293.66, 392.0, 293.66, 246.94], pad: [196.0, 246.94, 293.66] },
]
const CHORD_DUR = 4.5
const PASS_DUR = CHORD_DUR * CHORDS.length

const buf = new Float64Array(N)

function triangle(phase) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase))
}

/**
 * One plucked-harp-ish note: sine fundamental with soft upper partials, a
 * detuned twin for warmth, a whisper of triangle, short attack + long
 * exponential decay. `start` in seconds; the tail wraps around the buffer.
 */
function addNote(start, freq, amp, ringDur) {
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

/** Sustained tone with slow attack/release — the pad and the drone. */
function addHold(start, dur, freq, amp, attackDur, releaseDur, octaveAmp = 0) {
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

for (let pass = 0; pass < DURATION / PASS_DUR; pass++) {
  for (let c = 0; c < CHORDS.length; c++) {
    const chord = CHORDS[c]
    const chordStart = pass * PASS_DUR + c * CHORD_DUR

    addHold(chordStart, CHORD_DUR, chord.root, 0.13, 0.8, 0.8, 0.5)
    for (const freq of chord.pad) {
      addHold(chordStart, CHORD_DUR, freq, 0.035, 1.2, 1.4)
    }

    const step = CHORD_DUR / chord.arp.length
    chord.arp.forEach((freq, n) => {
      // Alternate passes lift the arpeggio an octave, quieter, for variation.
      const lift = pass % 2 === 1
      addNote(chordStart + n * step, lift ? freq * 2 : freq, lift ? 0.1 : 0.14, 1.6)
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

const outDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/assets/audio')
mkdirSync(outDir, { recursive: true })
const outFile = resolve(outDir, 'radio-spike.wav')
writeFileSync(outFile, Buffer.concat([header, pcm]))
console.log(`wrote ${outFile} (${((44 + pcm.length) / 1024 / 1024).toFixed(2)} MB, ${DURATION}s)`)
