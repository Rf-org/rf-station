import { useEffect, useRef, useState } from 'react';
import type { SpotPolygon } from '../vision/zone';

interface Props {
  video: HTMLVideoElement | null;
  initial: SpotPolygon | null;
  onDone(poly: SpotPolygon): void;
  onCancel(): void;
}

// Staff-only: draw the floor spot as a polygon on the live camera view.
// Click adds a vertex; Done closes and saves (normalized 0..1 coords).
export function CalibrationOverlay({ video, initial, onDone, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<[number, number][]>(initial?.points ?? []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const vid = video;
    if (!canvas || !vid) return;
    let raf = 0;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (ctx && vid.videoWidth) {
        if (canvas.width !== vid.clientWidth || canvas.height !== vid.clientHeight) {
          canvas.width = vid.clientWidth;
          canvas.height = vid.clientHeight;
        }
        ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#ffb347';
        ctx.lineWidth = 4;
        ctx.fillStyle = '#ffb347';
        ctx.beginPath();
        points.forEach(([x, y], i) => {
          const px = x * canvas.width;
          const py = y * canvas.height;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
          ctx.fillRect(px - 5, py - 5, 10, 10);
        });
        if (points.length > 2) ctx.closePath();
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video, points]);

  const addPoint = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    setPoints((p) => [...p, [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]]);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 60 }}>
      <canvas ref={canvasRef} onClick={addPoint} style={{ width: '100%', height: '100%', cursor: 'crosshair' }} />
      <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, display: 'flex', gap: 16, justifyContent: 'center' }}>
        <button onClick={() => setPoints([])}>Clear</button>
        <button onClick={onCancel}>Cancel</button>
        <button
          disabled={points.length < 3}
          onClick={() => onDone({ points })}
          style={{ fontWeight: 700 }}
        >
          Done — save spot ({points.length} pts)
        </button>
      </div>
      <p style={{ position: 'absolute', top: 16, left: 0, right: 0, textAlign: 'center', color: '#ffb347' }}>
        Click to draw the floor spot polygon. The session starts when feet are inside it.
      </p>
    </div>
  );
}
