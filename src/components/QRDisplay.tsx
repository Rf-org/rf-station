
import { useEffect, useState } from 'react';

// ponytail: backend renders the QR; countdown clamped at 0:00, single interval.
export function QRDisplay({ pngB64, expiresInS }: { pngB64: string; expiresInS: number }) {
  const [left, setLeft] = useState(expiresInS);
  useEffect(() => {
    setLeft(expiresInS);
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [expiresInS, pngB64]);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div
      style={{
        position: 'fixed',
        right: '4vw',
        bottom: '8vh',
        background: 'rgba(11,9,6,0.9)',
        border: '2px solid #ffb347',
        borderRadius: 16,
        padding: 20,
        textAlign: 'center',
        color: '#f5ead9',
        zIndex: 30,
      }}
    >
      <p style={{ fontSize: 22, fontWeight: 700, margin: '0 0 12px' }}>
        Want your rider card and updates? Scan here
      </p>
      <img
        src={`data:image/png;base64,${pngB64}`}
        alt="QR code for rider card and updates"
        width={220}
        height={220}
        style={{ borderRadius: 8 }}
      />
      <p style={{ fontSize: 20, margin: '12px 0 0', color: '#ffb347' }} aria-live="polite">
        Code expires in {mm}:{ss}
      </p>
    </div>
  );
}
