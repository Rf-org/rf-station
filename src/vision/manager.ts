// VisionManager: camera + worker lifecycle, floor-spot dwell state machine.
// Events drive the session director: APPROACH (stir) → ON_SPOT → DWELL (start)
// → LEFT_SPOT → WALK_TIMEOUT (end). Frames stay in the browser.

import { feetInSpot, type SpotPolygon } from './zone';
import type { WorkerIn, WorkerOut, WorkerPerson } from './worker';

export type VisionEvent = 'APPROACH' | 'ON_SPOT' | 'DWELL' | 'LEFT_SPOT' | 'WALK_TIMEOUT';
export type VisionStatus = 'starting' | 'running' | 'failed';

/** Pure one-rider rule: how many face-visible persons stand on the floor spot. */
export function countOnSpot(persons: WorkerPerson[], spot: SpotPolygon | null): number {
  if (spot === null) return 0;
  return persons.filter((p) => p.face && feetInSpot([p.feet], spot)).length;
}

const STORAGE_KEY = 'rf.spot.v1';
const FRAME_MS = 100; // ~10 fps
const DWELL_MS = 1500;
const WALK_AWAY_MS = 4000;
const INIT_TIMEOUT_MS = 30_000;

export class VisionManager {
  private listeners: Array<(e: VisionEvent) => void> = [];
  private spot: SpotPolygon | null = null;
  private worker: Worker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private frameTimer = 0;
  private dwellTimer = 0;
  private walkTimer = 0;
  private present = false;
  private onSpot = false;
  // One frame in flight: the worker is slower than the 100 ms cadence on weak
  // GPUs. Without this, bitmaps queue up and memory grows over a 10 h day.
  private inflight = false;
  private innerStatus: VisionStatus = 'starting';

  constructor(private video: HTMLVideoElement) {
    // ponytail: a corrupt spot entry just means "no spot" — no migration, no schema version (ceiling: KEY name is the version).
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.spot = JSON.parse(raw) as SpotPolygon;
    } catch {
      this.spot = null;
    }
  }

  get status(): VisionStatus {
    return this.innerStatus;
  }

  onEvent(cb: (e: VisionEvent) => void): void {
    this.listeners.push(cb);
  }

  setSpot(poly: SpotPolygon): void {
    this.spot = poly;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(poly));
  }

  getSpot(): SpotPolygon | null {
    return this.spot;
  }

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === 'result') this.handleResult(msg.persons);
    };
    const initMsg: WorkerIn = { type: 'init' };
    this.worker.postMessage(initMsg);

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.innerStatus = 'failed';
        this.stop();
        reject(new Error('vision init timed out'));
      }, INIT_TIMEOUT_MS);
      const onInit = (e: MessageEvent<WorkerOut>) => {
        const msg = e.data;
        if (msg.type === 'ready' || msg.type === 'fatal') {
          window.clearTimeout(timeout);
          this.worker?.removeEventListener('message', onInit);
          if (msg.type === 'ready') {
            this.innerStatus = 'running';
            resolve();
          } else {
            this.innerStatus = 'failed';
            this.stop();
            reject(new Error(msg.message));
          }
        }
      };
      // ponytail: addEventListener (not onmessage) here so the result handler can coexist.
      this.worker!.addEventListener('message', onInit);
    });

    this.frameTimer = window.setInterval(() => this.captureFrame(), FRAME_MS);
  }

  stop(): void {
    // Kiosk runs 10 h/day: every timer dies here.
    window.clearInterval(this.frameTimer);
    window.clearTimeout(this.dwellTimer);
    window.clearTimeout(this.walkTimer);
    this.frameTimer = 0;
    this.dwellTimer = 0;
    this.walkTimer = 0;
    this.worker?.terminate();
    this.worker = null;
    const stream = this.video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.present = false;
    this.onSpot = false;
    this.inflight = false;
  }

  private emit(e: VisionEvent): void {
    for (const cb of [...this.listeners]) cb(e);
  }

  private captureFrame(): void {
    if (!this.worker || this.video.videoWidth === 0) return;
    if (this.inflight) return; // worker still chewing the last frame — skip
    if (!this.canvas) this.canvas = document.createElement('canvas');
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(this.video, 0, 0);
    this.inflight = true;
    createImageBitmap(this.canvas)
      .then((bitmap) => {
        const msg: WorkerIn = { type: 'frame', bitmap, ts: performance.now() };
        this.worker?.postMessage(msg, [bitmap]);
      })
      .catch(() => {
        this.inflight = false; // drop the frame
      });
  }

  private handleResult(persons: WorkerPerson[]): void {
    this.inflight = false;
    const spot = this.spot;
    const hasPerson = persons.length > 0;
    if (hasPerson && !this.present) this.emit('APPROACH');
    this.present = hasPerson;

    // One-rider rule: exactly one face-on-feet person on the spot. Two or more
    // → don't start (and cancel a pending dwell); the floor decal says one rider.
    const nowOnSpot = countOnSpot(persons, spot) === 1;

    if (nowOnSpot && !this.onSpot) {
      this.onSpot = true;
      window.clearTimeout(this.walkTimer);
      this.walkTimer = 0;
      this.emit('ON_SPOT');
      window.clearTimeout(this.dwellTimer);
      this.dwellTimer = window.setTimeout(() => {
        this.dwellTimer = 0;
        if (this.onSpot) this.emit('DWELL');
      }, DWELL_MS);
    } else if (!nowOnSpot && this.onSpot) {
      this.onSpot = false;
      window.clearTimeout(this.dwellTimer);
      this.dwellTimer = 0;
      this.emit('LEFT_SPOT');
      this.walkTimer = window.setTimeout(() => {
        this.walkTimer = 0;
        if (!this.onSpot) this.emit('WALK_TIMEOUT');
      }, WALK_AWAY_MS);
    }
    // Steady state (still on / still off): timers keep running; re-evaluated at fire time.
  }
}
