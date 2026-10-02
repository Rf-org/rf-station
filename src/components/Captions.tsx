// ponytail: one function, inline styles, no CSS file needed.
export function Captions({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <div
      aria-live="polite"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '8vh',
        transform: 'translateX(-50%)',
        maxWidth: '80vw',
        textAlign: 'center',
        color: '#f5ead9',
        fontSize: 'clamp(24px, 3.2vw, 44px)',
        fontWeight: 600,
        lineHeight: 1.35,
        textShadow: '0 2px 18px rgba(0,0,0,0.85)',
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {text}
    </div>
  );
}
