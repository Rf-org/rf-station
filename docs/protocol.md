# RF Station ↔ Backend WebSocket Protocol v1

Canonical copy lives in `rf-backend/docs/protocol.md`. The frontend repo carries the same file;
if they disagree, the backend copy wins.

## Transport

- `wss://<backend-host>/ws/session?token=<station_token>`
- Token validated on connect. Invalid/expired → close code **4401** (client must
  re-register, never retry). Rate-limited → close code **4408** (client retries
  with backoff, keeps its token).
- One socket per live session. JSON text frames only, each with a `type` field.
- `station_token`: daily-rotated, per-station. Never an API key.

## HTTP (same host)

| method | path | body → response |
|---|---|---|
| `POST` | `/api/stations/register` | `{code}` → `{station_id, token, expires_ms}` |
| `POST` | `/api/stations/heartbeat` | `{station_id, app_version}` → `200` (every 10 s) |

## Audio

- Client → server: 16 kHz mono PCM16, 100 ms chunks (1600 samples), base64 in JSON.
- `ponytail: base64-in-JSON costs ~33% overhead at 10 msg/s; upgrade to binary Opus frames when measured.`
- Server → client: vendor-native audio chunks (mp3), base64 in JSON.
- Fake TTS (dev): WAV silence with realistic duration (`len(text)/14` seconds).

## Client → server

| type | fields | notes |
|---|---|---|
| `session.start` | `station_id`, `app_version`, `consent_version`, `qb_version` | versions must match backend's; mismatch → `error` (recoverable, prompts reload) |
| `audio.chunk` | `seq`, `pcm16_b64` | only while push-to-talk held |
| `utterance.end` | — | button released; server finalizes STT |
| `metrics.latency` | `line_id`, `ms` | client-measured: button release → first audio out of speakers |
| `session.end` | `reason` | `completed` \| `walkaway` \| `timeout` \| `user_skip` \| `error` |
| `ping` | — | → `pong` |
| `debug.transcript` | `text` | **dev only** (backend `FAKE_MODE=1`): injects a transcript, skips STT |

## Server → client

| type | fields | notes |
|---|---|---|
| `session.started` | `session_id` | random UUID |
| `avatar.state` | `state`, `gaze?`, `glow?`, `warmth?`, `emotion?` | `state` ∈ `dormant,stirring,wake,listening,thinking,speaking,error,goodbye`; gaze `[x,y]` 0..1; glow/warmth 0..1; `emotion` 0–4 = neutral/curious/excited/adventurous/reflective (drives the ThumpSM `emotion` input while speaking) |
| `speak.start` | `line_id`, `text`, `cached`, `audio_name?` | show caption + switch avatar to `speaking` immediately. `cached=true` → `audio_name` is REQUIRED and the client plays `/audio/<audio_name>.wav` from its local cache; the server MUST NOT send any `speak.audio` for that `line_id`. `cached=false` → streamed audio follows. |
| `speak.audio` | `line_id`, `seq`, `b64`, `final` | append and play in order; `final` = last chunk |
| `qr.show` | `url`, `png_b64`, `expires_in_s` | QR rendered server-side; frontend shows `<img>` |
| `session.ended` | `reason` | |
| `error` | `code`, `message`, `recoverable` | `VERSION_MISMATCH` (reload the station app) is the only fatal one; everything else is recoverable |
| `pong` | — | |

## Controller stages (backend)

`greeting` (pre-recorded) → `await_consent` (button press = consent) → `q1` → `q2` → `q3`
→ `closing` (pre-recorded + `qr.show`).

The LLM acts only in `q1`–`q3` (plus at most one follow-up per session). It returns
constrained JSON:
`{ "ack": "<=12 words>", "question": "<=25 words>", "emotion": 0-4, "extract": {...} }`.
`emotion` classifies the emotional character of the visitor's answer
(0 neutral, 1 curious, 2 excited, 3 adventurous, 4 reflective) and is validated
server-side (default 0). The controller owns stage transitions; the LLM never does.

Fixed (pre-recorded, cached) lines and their `audio_name`s:
`greeting`, `goodbye`, `fallback_q1`, `fallback_q2`, `fallback_q3`,
`didnt_catch`, `safety_close`.
(Deflect lines are streamed, not cached: each embeds the current stage's
fallback question, so no single recording covers them.)

## Frontend session states

`attract` → `notice` → `greet` → `consent` → `q1` → `q2` → `q3` → `close` → `reset` → `attract`.
Vision events (`person_on_spot`, `dwell_complete`, `walkaway`) drive the early states;
`avatar.state` / `speak.*` drive the rest.

## Latency contract

p95 button-release → first audio ≤ 2.5 s, measured client-side and reported via
`metrics.latency`. Every turn over 2 s: server sends the pre-recorded fallback line instead.
