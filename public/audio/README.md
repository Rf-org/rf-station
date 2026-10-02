# public/audio — pre-recorded fixed lines

These WAVs are **placeholders** (audibly synthetic blips). They let the kiosk run
end-to-end before Thump's voice is recorded.

Before the event, replace them with the real recordings — same filenames.
The server names the file per line via `speak.start.audio_name`; the client
plays `/audio/<audio_name>.wav` from the local cache and the server sends no
`speak.audio` for cached lines.

| File | `audio_name` | Used for |
| ---- | ------------ | -------- |
| `greeting.wav` | `greeting` | Session greeting (zero network wait) |
| `goodbye.wav` | `goodbye` | Session close |
| `fallback_q1.wav` | `fallback_q1` | Pre-recorded Q1 (any brain failure on turn 1) |
| `fallback_q2.wav` | `fallback_q2` | Pre-recorded Q2 |
| `fallback_q3.wav` | `fallback_q3` | Pre-recorded Q3 |
| `didnt_catch.wav` | `didnt_catch` | Empty / unintelligible answer |
| `safety_close.wav` | `safety_close` | Severe input: calm close |

Deflect lines (`deflect_mild`, `deflect_trick`) are intentionally **not** cached:
the server streams them via TTS because each one embeds the current stage's
fallback question, so no single recording can cover them.

Regenerate placeholders: `npm run gen:audio`.

The service worker cache-firsts `/audio/*`, so after the first (online) load these
play with zero network wait even if connectivity drops mid-event.
