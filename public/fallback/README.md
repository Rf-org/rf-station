# public/fallback — offline / degraded experience

No static assets are needed here: the offline experience is the attract screen
("A spirit sleeps here. Step closer to wake it.") rendered by the app shell,
which the service worker keeps cached, plus the pre-recorded lines in
`../audio/` (also cached).

Behaviour when the network or backend is down:

| Fault | Visitor sees |
| ----- | ------------ |
| Internet drops | Thump dims to a "taking a short break" idle (attract screen) |
| Backend unreachable | Sessions can't start; attract screen stays up |
| Camera fails | Thump idles; button press starts sessions (vision-failed fallback) |

This directory exists so the degraded-experience assets have a home if the
design later needs one (e.g. a branded "back soon" card).
