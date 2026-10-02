# rf-station — Motoverse kiosk frontend

React + Vite + TypeScript kiosk app that runs on every Motoverse display. It owns
everything on the device: the Thump avatar (Rive), camera vision (MediaPipe),
microphone + push-to-talk capture, captions, QR display, staff controls — and the
WebSocket voice session to the backend (`rf-backend`).

**The browser never holds an API key.** Only the station token (from staff
registration, in `localStorage`), sent as `?token=` on the WebSocket.

## Quick start

```bash
npm install
cp .env.example .env        # point VITE_BACKEND_WS / VITE_BACKEND_HTTP at the backend
npm run dev                 # local dev
npm test                    # vitest (29 checks: session machine, avatar director, vision zone, audio)
npm run build               # tsc + vite → dist/
npm run gen:audio           # regenerate placeholder fixed-line WAVs
```

Docker: `docker build -t rf-station .` (nginx serves `dist/`, SPA fallback included).

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `VITE_BACKEND_WS` | `wss://localhost:8000` | WebSocket base; sessions open at `/ws/session?token=…` |
| `VITE_BACKEND_HTTP` | `https://localhost:8000` | Registration + heartbeat (`/api/stations/register`, `/api/stations/heartbeat`) |
| `VITE_PTT_KEY` | `Space` | `e.code` the USB push-to-talk button emulates |
| `VITE_APP_VERSION` / `VITE_CONSENT_VERSION` / `VITE_QB_VERSION` | `0.1.0` / `1` / `1` | Sent in `session.start`; backend rejects mismatches (reload prompt) |

## Protocol

`docs/protocol.md` is the WebSocket contract (copied from `rf-protocol.md`); the
backend copy wins on disagreement. `src/protocol.ts` mirrors it in types, and
`parseServerMsg` strictly validates every inbound frame (unknown/malformed frames
are dropped at the socket).

Contract notes the frontend relies on:
- The socket opens on vision dwell; `session.start` is sent on socket open. The
  button press *is* the consent action — the backend treats the first audio
  activity as consent, then asks Q1.
- `speak.start(cached=true)` always carries `audio_name` and is **never**
  followed by `speak.audio` for that line: the client plays
  `/audio/<audio_name>.wav` from the local cache. (Belt and suspenders: the app
  also drops stray audio chunks for cached lines.)
- `avatar.state` may carry `emotion` 0–4 (neutral/curious/excited/adventurous/
  reflective), driven by the answer's emotional character; the director validates
  and defaults to neutral.
- Barge-in (button while Thump speaks): the client stops local playback and
  streams; chunks arriving for the superseded `line_id` are dropped.
- HTTP: `POST /api/stations/register {code}` → `{station_id, token}`;
  `POST /api/stations/heartbeat {station_id, app_version}` every 10 s.
- WS close `4401` = bad token (re-register, never retry); `4408` = rate-limited
  (retry with backoff, keep the token).

## Session flow

`attract → notice → greet → consent → q1 → q2 → q3 → close → reset → attract`
(pure state machine in `src/session/machine.ts`; the app owns timers and I/O).

- Vision: MediaPipe pose-lite + face detector in a Web Worker (~10 fps, one frame
  in flight so slow devices can't queue memory). Person approaches → Thump stirs;
  exactly one face-visible person on the calibrated floor spot for 1.5 s → session
  starts (two or more on the spot → no start; the floor decal says one rider).
  Off spot 4 s → "Still there?" → 5 s → walkaway reset.
  Camera failure → button press starts sessions (vision-failed fallback).
- Audio: 16 kHz PCM16, 100 ms chunks, streamed **only while push-to-talk is held**.
  Streaming mp3 playback via MediaSource; client-measured latency
  (button release → first audible chunk) reported as `metrics.latency`.
- Avatar: `rive/thump.riv` (ThumpSM: `state` 0–8, `emotion` 0–4, `warmth` 0–1).
  Pre/post-session the app drives it locally; mid-session `avatar.state` does.
  A procedural canvas fallback renders only if the `.riv` fails to load.
- Captions show **Thump's lines only**, never the visitor's words.
- Idle self-heal: reload when idle and (≥50 sessions or 2 h idle) — never mid-session.
- Offline: service worker (`public/sw.js`) cache-firsts `/audio/*` and the `.riv`;
  the attract screen works with no network after first load.

## Staff

Hidden gesture: 5 taps in the top-right 140 px square → staff panel.
Registration (enter code once → token stored), skip session, recalibrate floor
spot (draw polygon on the live camera view), mute, vision/version status.
In dev builds: transcript injector for `FAKE_MODE` backends.

## Kiosk setup (per display)

- Chrome kiosk: `chrome --kiosk --disable-features=Translate <url>`, auto-login + autostart at boot.
- Chrome policies for the origin (no prompts): camera/mic allow-list
  (`VideoCaptureAllowedUrls`, `AudioCaptureAllowedUrls`), autoplay allow-list.
- **HTTPS is required** for `getUserMedia`.
- Screen Wake Lock is requested by the app; also disable OS sleep.
- USB: directional mic + push-to-talk button (as key `VITE_PTT_KEY`) + webcam;
  floor spot decal in front of the display, drawn into the app via Recalibrate.

## Layout

```
src/
  protocol.ts      # protocol v1 types (law)
  config.ts        # env config (no secrets — token only, in localStorage)
  main.tsx         # boot: render, service worker, wake lock
  app/             # App.tsx — wires machine + socket + vision + avatar + audio
  session/         # pure state machine (tested)
  websocket/       # protocol client: reconnect backoff, ping/pong, 4401 = re-register
  vision/          # MediaPipe worker, floor-spot zone math (tested), manager
  avatar/          # Rive loader, director: protocol state → ThumpSM inputs (tested)
  audio/           # mic (16k PCM16 worklet), push-to-talk key, streaming playback (tested)
  components/      # captions, consent, QR, attract, error banner, hold button
  staff/           # registration, heartbeat, gesture, panel, spot calibration
public/audio/      # placeholder fixed-line WAVs — REPLACE with Thump's recorded voice
rive/thump.riv     # production rig (bundled via ?url import)
docs/protocol.md   # the contract
```
