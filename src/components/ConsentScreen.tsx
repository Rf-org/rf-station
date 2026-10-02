import type { CSSProperties } from 'react';

// ponytail: static copy only, no props/state.
export function ConsentScreen() {
  const wrap: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: '#0b0906',
    color: '#f5ead9',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4vh',
    textAlign: 'center',
    padding: '0 8vw',
    zIndex: 40,
  };
  return (
    <div style={wrap}>
      <p style={{ fontSize: 'clamp(28px, 3.6vw, 52px)', fontWeight: 700, margin: 0 }}>
        This experience is for adults (18+).
      </p>
      <p style={{ fontSize: 'clamp(22px, 2.8vw, 40px)', lineHeight: 1.5, margin: 0 }}>
        3 questions &middot; your answers are saved as text &middot; no audio or video is kept.
      </p>
      <p style={{ fontSize: 'clamp(22px, 2.8vw, 40px)', color: '#ffb347', fontWeight: 600, margin: 0 }}>
        Hold the button and say hi to start.
      </p>
    </div>
  );
}
