// RF Station ↔ Backend WebSocket Protocol v1 — law. Backend copy wins on disagreement.
// Canonical: rf-backend/docs/protocol.md. This file mirrors it; keep in sync.

export const PROTOCOL_VERSION = 'v1';

export type AvatarStateName =
  | 'dormant' | 'stirring' | 'wake' | 'listening'
  | 'thinking' | 'speaking' | 'error' | 'goodbye';

export type SessionEndReason =
  | 'completed' | 'walkaway' | 'timeout' | 'user_skip' | 'error';

// ---------------------------------------------------------------- client → server

export interface MsgSessionStart {
  type: 'session.start';
  station_id: string;
  app_version: string;
  consent_version: string;
  qb_version: string;
}
export interface MsgAudioChunk {
  type: 'audio.chunk';
  seq: number;
  pcm16_b64: string; // 16 kHz mono PCM16, 100 ms (1600 samples); only while PTT held
}
export interface MsgUtteranceEnd { type: 'utterance.end' }
export interface MsgLatency {
  type: 'metrics.latency';
  line_id: string;
  ms: number; // button release → first audio out of speakers, measured client-side
}
export interface MsgSessionEnd { type: 'session.end'; reason: SessionEndReason }
export interface MsgPing { type: 'ping' }
export interface MsgDebugTranscript { type: 'debug.transcript'; text: string } // dev only (FAKE_MODE=1)

export type ClientMsg =
  | MsgSessionStart | MsgAudioChunk | MsgUtteranceEnd | MsgLatency
  | MsgSessionEnd | MsgPing | MsgDebugTranscript;

// ---------------------------------------------------------------- server → client

export interface MsgSessionStarted { type: 'session.started'; session_id: string }
export interface MsgAvatarState {
  type: 'avatar.state';
  state: AvatarStateName;
  gaze?: [number, number]; // 0..1 — no rig input; ignored by the director
  glow?: number;          // 0..1 — no rig input; ignored by the director
  warmth?: number;        // 0..1 → Rive `warmth`
  emotion?: number;       // 0..4 → Rive `emotion` (neutral/curious/excited/adventurous/reflective)
}
export interface MsgSpeakStart {
  type: 'speak.start';
  line_id: string;
  text: string;   // caption source — always show this, never the visitor's words
  cached: boolean; // pre-recorded line: play /audio/<audio_name>.wav from the local cache.
  // The server MUST send audio_name iff cached=true, and MUST NOT send any
  // speak.audio frames for a cached line (double-audio guard).
  audio_name?: string; // e.g. greeting, goodbye, fallback_q1 … [a-z0-9_]{1,32}
}
export interface MsgSpeakAudio {
  type: 'speak.audio';
  line_id: string;
  seq: number;
  b64: string; // vendor-native mp3 (WAV silence in FAKE_MODE)
  final: boolean;
}
export interface MsgQrShow { type: 'qr.show'; url: string; png_b64: string; expires_in_s: number }
export interface MsgSessionEnded { type: 'session.ended'; reason: SessionEndReason }
export interface MsgError { type: 'error'; code: string; message: string; recoverable: boolean }
export interface MsgPong { type: 'pong' }

export type ServerMsg =
  | MsgSessionStarted | MsgAvatarState | MsgSpeakStart | MsgSpeakAudio
  | MsgQrShow | MsgSessionEnded | MsgError | MsgPong;

export const WS_CLOSE_BAD_TOKEN = 4401;
export const WS_CLOSE_RATE_LIMITED = 4408; // retry with backoff; do NOT wipe the token

// ---------------------------------------------------------------------------
// Strict validation of every inbound frame (trust boundary: the network).
// Returns the typed message, or null for anything malformed/unknown.
// Unknown extra fields are ignored; missing/m mistyped required fields reject.

const AVATAR_STATES: readonly string[] = [
  'dormant', 'stirring', 'wake', 'listening', 'thinking', 'speaking', 'error', 'goodbye',
];
const END_REASONS: readonly string[] = [
  'completed', 'walkaway', 'timeout', 'user_skip', 'error',
];
const AUDIO_NAME_RE = /^[a-z0-9_]{1,32}$/;

type Dict = Record<string, unknown>;

const isDict = (o: unknown): o is Dict => typeof o === 'object' && o !== null;
const isStr = (v: unknown, max = 2048): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isNum01 = (v: unknown): v is number | undefined =>
  v === undefined || (typeof v === 'number' && v >= 0 && v <= 1);

function parseAvatarState(d: Dict): MsgAvatarState | null {
  if (!AVATAR_STATES.includes(d.state as string)) return null;
  const m: MsgAvatarState = { type: 'avatar.state', state: d.state as AvatarStateName };
  if (d.emotion !== undefined) {
    if (!isInt(d.emotion, 0, 4)) return null;
    m.emotion = d.emotion;
  }
  if (!isNum01(d.warmth)) return null;
  if (d.warmth !== undefined) m.warmth = d.warmth;
  if (!isNum01(d.glow)) return null;
  if (d.glow !== undefined) m.glow = d.glow;
  if (d.gaze !== undefined) {
    const g: unknown = d.gaze;
    const okPair =
      Array.isArray(g) && g.length === 2 &&
      typeof g[0] === 'number' && g[0] >= 0 && g[0] <= 1 &&
      typeof g[1] === 'number' && g[1] >= 0 && g[1] <= 1;
    if (!okPair) return null;
    m.gaze = [g[0] as number, g[1] as number];
  }
  return m;
}

export function parseServerMsg(o: unknown): ServerMsg | null {
  if (!isDict(o) || typeof o.type !== 'string') return null;
  const d = o as Dict;
  switch (d.type) {
    case 'session.started':
      return isStr(d.session_id, 128)
        ? { type: 'session.started', session_id: d.session_id as string }
        : null;
    case 'avatar.state':
      return parseAvatarState(d);
    case 'speak.start': {
      if (!isStr(d.line_id, 64) || !isStr(d.text, 2000) || !isBool(d.cached)) return null;
      const m: MsgSpeakStart = {
        type: 'speak.start',
        line_id: d.line_id as string,
        text: d.text as string,
        cached: d.cached as boolean,
      };
      if (d.audio_name !== undefined) {
        if (typeof d.audio_name !== 'string' || !AUDIO_NAME_RE.test(d.audio_name)) return null;
        m.audio_name = d.audio_name;
      }
      // Contract: cached lines MUST name their local file.
      if (m.cached && !m.audio_name) return null;
      return m;
    }
    case 'speak.audio':
      return isStr(d.line_id, 64) && isInt(d.seq, 0, 1e6) &&
        typeof d.b64 === 'string' && d.b64.length <= 65536 && isBool(d.final)
        ? {
            type: 'speak.audio', line_id: d.line_id as string,
            seq: d.seq as number, b64: d.b64 as string, final: d.final as boolean,
          }
        : null;
    case 'qr.show':
      return isStr(d.url, 512) && typeof d.png_b64 === 'string' &&
        d.png_b64.length <= 524288 && isInt(d.expires_in_s, 0, 3600)
        ? {
            type: 'qr.show', url: d.url as string,
            png_b64: d.png_b64 as string, expires_in_s: d.expires_in_s as number,
          }
        : null;
    case 'session.ended':
      return END_REASONS.includes(d.reason as string)
        ? { type: 'session.ended', reason: d.reason as SessionEndReason }
        : null;
    case 'error':
      return isStr(d.code, 64) && typeof d.message === 'string' &&
        d.message.length <= 500 && isBool(d.recoverable)
        ? {
            type: 'error', code: d.code as string,
            message: d.message as string, recoverable: d.recoverable as boolean,
          }
        : null;
    case 'pong':
      return { type: 'pong' };
    default:
      return null;
  }
}

/** Legacy loose check — prefer parseServerMsg. Kept for one call-site. */
export function isServerMsg(o: unknown): o is ServerMsg {
  return parseServerMsg(o) !== null;
}
