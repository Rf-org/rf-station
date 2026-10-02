import { describe, expect, it } from 'vitest';
import { b64ToBytes } from '../src/audio/playback';
import { CHUNK_SAMPLES, pcm16ToB64, resampleLinear } from '../src/audio/mic';

describe('b64ToBytes', () => {
  it('round-trips PCM16 chunk bytes exactly', () => {
    const pcm = new Int16Array(CHUNK_SAMPLES);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 37 - 20000) % 32768;
    const bytes = b64ToBytes(pcm16ToB64(pcm));
    expect(bytes.length).toBe(pcm.length * 2);
    expect(new Int16Array(bytes.buffer)).toEqual(pcm);
  });

  it('chunk-size math: 1600 samples -> 3200 bytes -> base64 length 4268', () => {
    const b64 = pcm16ToB64(new Int16Array(CHUNK_SAMPLES));
    expect(b64.length).toBe(4268);
    expect(b64ToBytes(b64).length).toBe(CHUNK_SAMPLES * 2);
  });
});

describe('resampleLinear', () => {
  it('16k->16k is an identity copy', () => {
    const input = new Float32Array([0.1, -0.2, 0.3]);
    const out = resampleLinear(input, 16000, 16000);
    expect(out).not.toBe(input);
    expect(out).toEqual(input);
  });

  it('48k->16k yields in*16000/48000 samples with sane endpoints', () => {
    const n = 480;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++) input[i] = i / (n - 1); // 0..1 ramp
    const out = resampleLinear(input, 48000, 16000);
    expect(out.length).toBe((n * 16000) / 48000);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[out.length - 1]).toBeCloseTo(1, 6);
    expect(out[Math.floor(out.length / 2)]).toBeCloseTo(0.5, 2); // linearity
  });

  it('preserves constant signals', () => {
    const out = resampleLinear(new Float32Array(100).fill(0.7), 44100, 16000);
    for (const s of out) expect(s).toBeCloseTo(0.7, 6);
  });

  it('empty input stays empty', () => {
    expect(resampleLinear(new Float32Array(0), 48000, 16000).length).toBe(0);
  });
});
