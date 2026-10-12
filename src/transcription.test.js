import { describe, it, expect } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import fs from 'node:fs'
import path from 'node:path'
import { transcribeNotes, TRANSCRIBE_SAMPLE_RATE as SR } from './transcription.js'

function loadModel() {
  const dir = path.resolve(__dirname, '../public/models/basic-pitch')
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'))
  const bin = fs.readFileSync(path.join(dir, json.weightsManifest[0].paths[0]))
  return tf.loadGraphModel(tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: json.weightsManifest[0].weights,
    weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy,
  }))
}

// Karplus-Strong plucked strings with seeded noise, so the test is deterministic.
function strum(midis, seconds = 2) {
  let seed = 1
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const out = new Float32Array(SR * seconds)
  midis.forEach((midi, k) => {
    const f = 440 * 2 ** ((midi - 69) / 12)
    const N = Math.round(SR / f)
    const buf = Float32Array.from({ length: N }, () => rand() * 2 - 1)
    const s0 = Math.floor((0.1 + k * 0.015) * SR)
    for (let i = 0; s0 + i < out.length && i < 1.8 * SR; i++) {
      const j = i % N
      const v = buf[j]
      buf[j] = 0.996 * 0.5 * (buf[j] + buf[(j + 1) % N])
      out[s0 + i] += v * 0.15
    }
  })
  return out
}

describe('transcribeNotes (real model)', () => {
  it('finds C3 E3 G3 of an open-C strum with the right octaves', async () => {
    const notes = await transcribeNotes(strum([48, 52, 55, 60, 64]), loadModel())
    const strong = new Set(notes.filter((n) => n.amp >= 0.5).map((n) => n.midi))
    expect(strong.has(48)).toBe(true)
    expect(strong.has(52)).toBe(true)
    expect(strong.has(55)).toBe(true)
    for (const n of notes) expect(n.end).toBeGreaterThan(n.start)
  }, 60000)
})
