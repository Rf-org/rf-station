// Playback of server→client audio (`speak.audio`): streamed mp3 via MediaSource,
// WAV in dev FAKE_MODE (and as the no-MediaSource fallback). One line at a time;
// per-line elements so barge-in (stopLine) never cuts another line.

/** base64 → bytes. Pure; test-covered. */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isRiffWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
  ); // "RIFF"
}

interface Line {
  el: HTMLAudioElement;
  url: string; // object URL of MediaSource or played blob
  mode: 'mse' | 'buffer';
  ms: MediaSource | null;
  sb: SourceBuffer | null;
  queue: Uint8Array[]; // mse: in-order bytes awaiting SourceBuffer append
  store: Uint8Array[]; // buffer: in-order bytes until final
  pending: Map<number, Uint8Array>; // out-of-order chunks held by seq
  expected: number;
  finalSeen: boolean;
  ending: boolean;
  played: boolean; // buffer mode: blob already played
  fired: boolean; // onFirstAudible already fired for this line
}

export class AudioPlayer {
  /** Fired ONCE per line when the first streamed chunk actually makes sound. */
  onFirstAudible: (() => void) | null = null;
  /** Fired when a line's playback finishes (streamed or local-buffered). */
  onLineEnded: ((lineId: string) => void) | null = null;

  private lines = new Map<string, Line>();
  private muted = false;
  // Currently-playing cached line (playLocal), so barge-in can stop it too.
  private localCtl: { el: HTMLAudioElement; done: () => void } | null = null;

  private getLine(lineId: string, firstBytes: Uint8Array): Line {
    let line = this.lines.get(lineId);
    if (line) return line;
    const el = new Audio();
    el.muted = this.muted;
    el.addEventListener(
      'playing',
      () => {
        if (line && !line.fired) {
          line.fired = true;
          this.onFirstAudible?.();
        }
      },
      { once: true },
    );
    el.addEventListener('ended', () => {
      this.onLineEnded?.(lineId);
      this.dropLine(lineId);
    });
    if (isRiffWav(firstBytes)) {
      // Dev FAKE_MODE sends WAV: buffer whole line, play on final.
      line = this.freshLine(el, 'buffer');
    } else if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')) {
      const ms = new MediaSource();
      const url = URL.createObjectURL(ms);
      el.src = url;
      line = { ...this.freshLine(el, 'mse'), url, ms };
      ms.addEventListener('sourceopen', () => {
        if (!line) return;
        line.sb = line.ms!.addSourceBuffer('audio/mpeg');
        line.sb.addEventListener('updateend', () => this.pump(lineId));
        this.pump(lineId);
      });
      void el.play().catch(() => {});
    } else {
      // ponytail: no MediaSource (or no mp3 support) — buffer the whole mp3 and
      // play it as one blob on final. Ceiling: adds full-line latency vs
      // progressive streaming. Upgrade: polyfill/stream via WebAudio decode.
      line = this.freshLine(el, 'buffer');
    }
    this.lines.set(lineId, line);
    return line;
  }

  private freshLine(el: HTMLAudioElement, mode: 'mse' | 'buffer'): Line {
    return {
      el,
      url: '',
      mode,
      ms: null,
      sb: null,
      queue: [],
      store: [],
      pending: new Map(),
      expected: 0,
      finalSeen: false,
      ending: false,
      played: false,
      fired: false,
    };
  }

  feedChunk(lineId: string, b64: string, final: boolean, seq?: number): void {
    const bytes = b64ToBytes(b64);
    const line = this.getLine(lineId, bytes);
    const s = seq ?? line.expected;
    if (s < line.expected) return; // duplicate / late chunk: ignore
    line.pending.set(s, bytes);
    if (final) line.finalSeen = true;
    while (line.pending.has(line.expected)) {
      const chunk = line.pending.get(line.expected)!;
      line.pending.delete(line.expected);
      line.expected++;
      if (line.mode === 'mse') line.queue.push(chunk);
      else line.store.push(chunk);
    }
    if (line.mode === 'mse') this.pump(lineId);
    else if (line.finalSeen && line.pending.size === 0 && !line.played) this.playBuffered(line);
  }

  /** Append queued bytes to the SourceBuffer in order; end the stream on final. */
  private pump(lineId: string): void {
    const line = this.lines.get(lineId);
    if (!line || line.mode !== 'mse' || !line.sb || line.sb.updating || line.ending) return;
    if (line.queue.length > 0) {
      line.sb.appendBuffer(line.queue.shift()!);
      return;
    }
    if (line.finalSeen && line.pending.size === 0 && line.ms && line.ms.readyState === 'open') {
      line.ending = true;
      try {
        line.ms.endOfStream();
      } catch {
        /* already ended */
      }
    }
  }

  /** Buffer mode: concat chunks into one blob and play on final. */
  private playBuffered(line: Line): void {
    line.played = true;
    const mime = isRiffWav(line.store[0] ?? new Uint8Array(0)) ? 'audio/wav' : 'audio/mpeg';
    const blob = new Blob(line.store as BlobPart[], { type: mime });
    line.url = URL.createObjectURL(blob);
    line.el.src = line.url;
    void line.el.play().catch(() => {});
  }

  /** Pre-recorded line (`speak.start` cached=true): play /audio/<name>.wav. */
  playLocal(name: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      (async () => {
        try {
          const res = await fetch(`/audio/${name}.wav`);
          if (!res.ok) throw new Error(`cached audio missing: ${name}.wav (${res.status})`);
          const url = URL.createObjectURL(await res.blob());
          const el = new Audio(url);
          el.muted = this.muted;
          const done = () => {
            if (this.localCtl?.el === el) this.localCtl = null;
            URL.revokeObjectURL(url);
            resolve();
          };
          this.stopLocal(); // one cached line at a time
          this.localCtl = { el, done };
          el.addEventListener('ended', done, { once: true });
          el.addEventListener('error', () => reject(new Error(`failed to play ${name}.wav`)), {
            once: true,
          });
          await el.play();
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    });
  }

  private stopLocal(): void {
    const ctl = this.localCtl;
    this.localCtl = null;
    if (!ctl) return;
    try {
      ctl.el.pause();
    } catch {
      /* never started */
    }
    ctl.done(); // settle the playLocal() promise so callers don't hang
  }

  /** Barge-in: silence this line and drop its queued chunks. */
  stopLine(lineId: string): void {
    this.stopLocal();
    const line = this.lines.get(lineId);
    if (!line) return;
    try {
      line.el.pause();
    } catch {
      /* never initialized */
    }
    this.dropLine(lineId);
  }

  private dropLine(lineId: string): void {
    const line = this.lines.get(lineId);
    if (!line) return;
    this.lines.delete(lineId);
    line.el.removeAttribute('src');
    line.el.load();
    if (line.url) URL.revokeObjectURL(line.url);
  }

  stopAll(): void {
    this.stopLocal();
    for (const id of [...this.lines.keys()]) this.stopLine(id);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    for (const line of this.lines.values()) line.el.muted = m;
  }
}
