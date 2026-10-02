// Generates placeholder WAVs for the pre-recorded fixed lines.
// These are audibly synthetic (soft blips) so nobody mistakes them for Thump's
// real recorded voice. Replace with the real recordings before the event —
// same filenames, same /audio/ path (the service worker caches them).
// Run: npm run gen:audio
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');
mkdirSync(outDir, { recursive: true });

const RATE = 22050;

function wav(seconds, blips) {
  const n = Math.floor(seconds * RATE);
  const data = new Int16Array(n);
  for (const [t0, freq, dur] of blips) {
    const start = Math.floor(t0 * RATE);
    const len = Math.floor(dur * RATE);
    for (let i = 0; i < len && start + i < n; i++) {
      const env = Math.sin((Math.PI * i) / len); // smooth in/out
      data[start + i] = Math.floor(9000 * env * Math.sin(2 * Math.PI * freq * (i / RATE)));
    }
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(data[i], 44 + i * 2);
  return buf;
}

const files = {
  // audio_name → placeholder. Must match the backend's fixed lines 1:1
  // (fixed_lines keys + fallback_<stage> per question-bank stage).
  'greeting.wav': wav(2.5, [[0.1, 520, 0.35], [0.6, 660, 0.35]]),
  'goodbye.wav': wav(2.5, [[0.1, 660, 0.35], [0.6, 520, 0.35]]),
  'fallback_q1.wav': wav(2.0, [[0.1, 440, 0.3]]),
  'fallback_q2.wav': wav(2.0, [[0.1, 440, 0.3], [0.5, 494, 0.3]]),
  'fallback_q3.wav': wav(2.0, [[0.1, 440, 0.3], [0.5, 494, 0.3], [0.9, 523, 0.3]]),
  'didnt_catch.wav': wav(1.5, [[0.1, 330, 0.25], [0.45, 330, 0.25]]),
  'safety_close.wav': wav(2.0, [[0.1, 262, 0.4], [0.6, 262, 0.4]]),
};
// NOTE: deflect_mild / deflect_trick are intentionally NOT cached — the server
// streams them (each deflect line embeds the current stage's fallback question,
// so no single recording can cover them).

for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(outDir, name), buf);
  console.log('wrote', name, buf.length, 'bytes');
}
