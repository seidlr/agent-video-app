/**
 * MediaPipe face/pose detection, run on the MAIN THREAD (not a worker) per the plan's Task 8 Key
 * Decisions -- `@mediapipe/tasks-vision`'s own `FaceDetector`/`PoseLandmarker` already do their
 * heavy lifting inside a WASM/WebGL context they manage themselves, and (unlike transformers.js)
 * this package has no ModelRegistry-style cache/size-introspection API to route through
 * ml/client.ts's shared `ensureModel` gate -- so this module implements its own small,
 * self-contained version of that same `model_not_loaded`/`confirmDownload` contract instead.
 *
 * WASM fileset and model asset URLs verified live (real HTTP 200s, not assumed): the jsDelivr
 * path matches the exact version installed (`@mediapipe/tasks-vision@1.0.1`); the two model URLs
 * match the official MediaPipe sample code's own `models` map for these exact model choices
 * (BlazeFace "short-range", pose landmarker "lite").
 */
import { FaceDetector, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Detection, PoseLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_FILESET_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm`;
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// SHORTCUT: hardcoded from a live HEAD-equivalent check (229,746 B / 5,777,746 B respectively),
// not introspected at runtime the way ml/client.ts's ensureModel does via ModelRegistry.
// get_file_metadata for transformers.js models -- MediaPipe's own loading API has no equivalent
// for a raw CDN/GCS asset URL. Upgrade trigger: pin drift (a version bump changing these URLs).
const FACE_MODEL_SIZE_MB = 0.23;
const POSE_MODEL_SIZE_MB = 5.78;

let faceDetector: FaceDetector | null = null;
let poseLandmarker: PoseLandmarker | null = null;

export type EnsureMediaPipeModelResult = { ok: true } | { ok: false; error: 'model_not_loaded'; hint: string; sizeMB: number };

/** Tries the GPU delegate first (per the plan's "GPU delegate with CPU fallback"), retrying on
 * wasm/CPU if creating the task with a WebGL context fails (unsupported hardware, or `canvas` GPU
 * context conflicts with the page's own WebGPU usage elsewhere in this app). */
async function createWithDelegateFallback<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch {
    return create('CPU');
  }
}

export async function ensureFaceDetector(confirmDownload?: boolean): Promise<EnsureMediaPipeModelResult> {
  if (faceDetector) return { ok: true };
  if (!confirmDownload) {
    return { ok: false, error: 'model_not_loaded', hint: `Call again with confirmDownload:true to download ${FACE_MODEL_SIZE_MB}MB (blaze-face-short-range)`, sizeMB: FACE_MODEL_SIZE_MB };
  }
  const wasmFileset = await FilesetResolver.forVisionTasks(WASM_FILESET_URL);
  faceDetector = await createWithDelegateFallback((delegate) =>
    FaceDetector.createFromOptions(wasmFileset, { baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate }, runningMode: 'IMAGE' }),
  );
  return { ok: true };
}

export async function ensurePoseLandmarker(confirmDownload?: boolean): Promise<EnsureMediaPipeModelResult> {
  if (poseLandmarker) return { ok: true };
  if (!confirmDownload) {
    return { ok: false, error: 'model_not_loaded', hint: `Call again with confirmDownload:true to download ${POSE_MODEL_SIZE_MB}MB (pose-landmarker-lite)`, sizeMB: POSE_MODEL_SIZE_MB };
  }
  const wasmFileset = await FilesetResolver.forVisionTasks(WASM_FILESET_URL);
  poseLandmarker = await createWithDelegateFallback((delegate) =>
    PoseLandmarker.createFromOptions(wasmFileset, { baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate }, runningMode: 'IMAGE' }),
  );
  return { ok: true };
}

export interface FaceDetection {
  box: { x: number; y: number; w: number; h: number };
  keypoints: { x: number; y: number; label?: string }[];
  score: number;
}

/** `Detection.boundingBox` is in PIXEL coordinates (unlike `keypoints`, already normalized) --
 * needs the source image's own pixel dimensions to convert to this app's normalized [0,1] boxes. */
function normalizeDetection(detection: Detection, imageWidth: number, imageHeight: number): FaceDetection {
  const box = detection.boundingBox;
  return {
    box: box
      ? { x: box.originX / imageWidth, y: box.originY / imageHeight, w: box.width / imageWidth, h: box.height / imageHeight }
      : { x: 0, y: 0, w: 0, h: 0 },
    keypoints: detection.keypoints.map((k) => ({ x: k.x, y: k.y, label: k.label })),
    score: detection.categories[0]?.score ?? 0,
  };
}

export function detectFacesOnBitmap(bitmap: ImageBitmap): FaceDetection[] {
  if (!faceDetector) throw new Error('model_not_loaded: call ensureFaceDetector first');
  const { detections } = faceDetector.detect(bitmap);
  return detections.map((d) => normalizeDetection(d, bitmap.width, bitmap.height));
}

export interface PoseDetection {
  landmarks: { x: number; y: number; z: number; visibility: number }[];
}

export function detectPoseOnBitmap(bitmap: ImageBitmap): PoseDetection[] {
  if (!poseLandmarker) throw new Error('model_not_loaded: call ensurePoseLandmarker first');
  const result: PoseLandmarkerResult = poseLandmarker.detect(bitmap);
  return result.landmarks.map((landmarks) => ({ landmarks: landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility })) }));
}
