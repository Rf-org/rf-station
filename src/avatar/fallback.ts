// PROCEDURAL TESTING FALLBACK ONLY — not production art. Used when thump.riv
// fails to load (missing/corrupt rig, no WebGL, WASM blocked). Unblocks kiosk
// testing and smoke screens without the Rive rig. Never prefer this over the rig.
import type { AvatarHandle } from './loader';

const BG = '#0B0906';
const AMBER = '#FFB347';
const DEEP = '#FF7A1A';

export function createFallbackAvatar(canvas: HTMLCanvasElement): AvatarHandle {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const noop = () => undefined; // never throw — the kiosk must always show something
    return { setState: noop, setEmotion: noop, setWarmth: noop, dispose: noop };
  }
  let state = 0; // Rive numbering: 0 dormant … 8 goodbye
  let glowBoost = 0; // from emotion + warmth; light only, never geometry
  let raf = 0;
  let alive = true;

  const bpm = (s: number) => (s === 0 ? 40 : s === 4 || s === 7 ? 45 : 80);

  const draw = (now: number) => {
    if (!alive) return;
    const t = now / 1000;
    const w = (canvas.width = canvas.clientWidth || 640);
    const h = (canvas.height = canvas.clientHeight || 360);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.3;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    const pulse = 0.5 + 0.5 * Math.sin((t * bpm(state) * 2 * Math.PI) / 60);
    const intensity = Math.min(1, 0.45 + 0.45 * pulse + glowBoost);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2);
    g.addColorStop(0, AMBER);
    g.addColorStop(1, DEEP);
    ctx.globalAlpha = 0.25 + 0.5 * intensity;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.4 + 0.25 * pulse), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // goggle-ish eyes: closed arcs dormant, half-lid thinking/error, open otherwise
    const ex = r * 0.42;
    const ey = cy - r * 0.15;
    const er = r * 0.22;
    ctx.strokeStyle = '#E8B84B';
    ctx.lineWidth = Math.max(2, r * 0.06);
    for (const x of [cx - ex, cx + ex]) {
      if (state === 0) {
        ctx.beginPath(); // closed: curved lashes
        ctx.arc(x, ey + er * 0.4, er, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else {
        ctx.beginPath(); // open: ring + pupil
        ctx.arc(x, ey, er, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#FFF';
        ctx.beginPath();
        ctx.arc(x, ey, er * 0.45, 0, Math.PI * 2);
        ctx.fill();
        if (state === 4 || state === 7) {
          ctx.fillStyle = BG; // half-lid
          ctx.fillRect(x - er - 2, ey - er - 2, er * 2 + 4, er * 0.9);
        }
      }
    }
    raf = requestAnimationFrame(draw);
  };

  raf = requestAnimationFrame(draw);

  return {
    setState: (n) => {
      state = n;
    },
    // ponytail: emotion/warmth only nudge light intensity; geometry stays fixed,
    // mirroring the rig's base-identity rule (overlays only, no redesign).
    setEmotion: (n) => {
      glowBoost = Math.min(0.6, glowBoost + (n === 0 ? -0.3 : 0.15 * n));
    },
    setWarmth: (x) => {
      glowBoost = Math.min(0.6, glowBoost + x * 0.2);
    },
    dispose: () => {
      alive = false;
      cancelAnimationFrame(raf);
    },
  };
}
