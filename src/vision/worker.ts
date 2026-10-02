// MediaPipe Tasks Vision worker. Instantiated by VisionManager as:
//   new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
// Runs pose + face detection off the main thread at ~10 fps. Frames never leave
// the browser; the worker receives ImageBitmaps and posts back plain data.

import { FaceDetector, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export interface WorkerPerson {
  feet: [number, number]; // normalized x,y — average of landmarks 29,30,31,32
  face: boolean; // any face detection center inside person bbox expanded by 20%
}

export type WorkerIn = { type: 'init' } | { type: 'frame'; bitmap: ImageBitmap; ts: number };
export type WorkerOut =
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'result'; ts: number; persons: WorkerPerson[] };

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

// Landmark indices: 29/30 heels, 31/32 foot indices
const FEET_IDX = [29, 30, 31, 32];

// Narrow `self` so this file typechecks under both DOM and WebWorker libs.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
  postMessage: (msg: WorkerOut) => void;
};

let pose: PoseLandmarker | null = null;
let face: FaceDetector | null = null;

function fatal(err: unknown): WorkerOut {
  return { type: 'fatal', message: err instanceof Error ? err.message : String(err) };
}

async function init(): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  pose = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 4,
  });
  face = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
  });
}

function handleFrame(bitmap: ImageBitmap, ts: number): void {
  try {
    const poseRes = pose!.detectForVideo(bitmap, ts);
    const faceRes = face!.detectForVideo(bitmap, ts);

    const faces = (faceRes.detections ?? []).map((d) => {
      const b = d.boundingBox!;
      return {
        x: (b.originX + b.width / 2) / bitmap.width,
        y: (b.originY + b.height / 2) / bitmap.height,
      };
    });

    const persons: WorkerPerson[] = [];
    for (const lm of poseRes.landmarks ?? []) {
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const p of lm) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      // ponytail: 20% expansion is a fixed constant, not a tunable (ceiling: tight crowds may merge bboxes).
      const x0 = Math.max(0, minX - (maxX - minX) * 0.2);
      const y0 = Math.max(0, minY - (maxY - minY) * 0.2);
      const x1 = Math.min(1, maxX + (maxX - minX) * 0.2);
      const y1 = Math.min(1, maxY + (maxY - minY) * 0.2);
      const feet: [number, number] = [
        FEET_IDX.reduce((s, i) => s + lm[i].x, 0) / FEET_IDX.length,
        FEET_IDX.reduce((s, i) => s + lm[i].y, 0) / FEET_IDX.length,
      ];
      persons.push({ feet, face: faces.some((f) => f.x >= x0 && f.x <= x1 && f.y >= y0 && f.y <= y1) });
    }
    scope.postMessage({ type: 'result', ts, persons });
  } catch {
    // One bad frame must never kill the loop.
    scope.postMessage({ type: 'result', ts, persons: [] });
  } finally {
    bitmap.close();
  }
}

scope.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    // Catch everything — a failed init must surface as `fatal`, never hang.
    init()
      .then(() => scope.postMessage({ type: 'ready' }))
      .catch((err: unknown) => scope.postMessage(fatal(err)));
  } else if (msg.type === 'frame') {
    if (pose && face) handleFrame(msg.bitmap, msg.ts);
    else msg.bitmap.close();
  }
};
