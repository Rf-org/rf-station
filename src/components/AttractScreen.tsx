
// ponytail: dormant copy only — no instructions, no QR, per the character brief.
export function AttractScreen() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5vh',
        color: '#f5ead9',
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      <p style={{ fontSize: 'clamp(32px, 4vw, 60px)', fontWeight: 700, margin: 0 }}>
        A spirit sleeps here.
      </p>
      <p style={{ fontSize: 'clamp(22px, 2.8vw, 40px)', color: '#ffb347', margin: 0 }}>
        Step closer to wake it.
      </p>
    </div>
  );
}
