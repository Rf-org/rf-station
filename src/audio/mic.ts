// Microphone capture: 16 kHz mono PCM16, 100 ms chunks (1600 samples).
// Used for protocol `audio.chunk` while push-to-talk is held.

export const CHUNK_SAMPLES = 1600; // 100 ms @ 16 kHz
export const CHUNK_MS = 100;

/** Linear resample, one implementation — also injected into the worklet via .toString(). */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (input.length === 0) return new Float32Array(0);
  if (fromRate === toRate || fromRate <= 0 || toRate <= 0) return input.slice();
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  if (outLen === 1) return new Float32Array([input[0]]);
  const out = new Float32Array(outLen);
  const scale = (input.length - 1) / (outLen - 1);
  for (let i = 0; i < outLen; i++) {
    const p = i * scale;
    const lo = p | 0;
    const hi = Math.min(lo + 1, input.length - 1);
    const f = p - lo;
    out[i] = input[lo] + (input[hi] - input[lo]) * f;
  }
  return out;
}

/** Little-endian PCM16 → base64 for protocol `audio.chunk`. */
export function pcm16ToB64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export interface MicHandle {
  stop(): void;
}

const WORKLET_SOURCE = `
const resampleLinear = ${resampleLinear.toString()};
const CHUNK = ${CHUNK_SAMPLES};
class MicProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(0); }
  append(inBlock) {
    const out = sampleRate === 16000 ? inBlock : resampleLinear(inBlock, sampleRate, 16000);
    const merged = new Float32Array(this.buf.length + out.length);
    merged.set(this.buf); merged.set(out, this.buf.length);
    this.buf = merged;
    while (this.buf.length >= CHUNK) {
      const pcm = new Int16Array(CHUNK);
      for (let i = 0; i < CHUNK; i++) {
        const s = Math.max(-1, Math.min(1, this.buf[i]));
        pcm[i] = Math.round(s * 32767);
      }
      this.buf = this.buf.slice(CHUNK);
      this.port.postMessage(pcm, [pcm.buffer]);
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.append(ch);
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
`;

/** Open the mic; emits exactly-1600-sample Int16Array chunks until stop(). */
export async function startMic(onChunk: (pcm: Int16Array) => void): Promise<MicHandle> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('Microphone access denied — allow the microphone and retry.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('No microphone found on this device.');
    }
    throw new Error(`Could not open the microphone: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ctx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  let stopped = false;
  try {
    await ctx.audioWorklet.addModule(url);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new Error(`Audio worklet failed to load: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    URL.revokeObjectURL(url);
  }

  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'mic-processor');
  node.port.onmessage = (ev: MessageEvent<Int16Array>) => {
    if (!stopped) onChunk(ev.data);
  };
  src.connect(node);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      try { src.disconnect(); node.disconnect(); } catch { /* already torn down */ }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
