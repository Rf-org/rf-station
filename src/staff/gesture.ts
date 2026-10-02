
// ponytail: 5 taps in the top-right 140×140 px square within 2.5 s.
export function bindStaffGesture(onOpen: () => void): () => void {
  const taps: number[] = [];
  const handler = (e: PointerEvent) => {
    if (e.clientX < window.innerWidth - 140 || e.clientY > 140) return;
    const now = performance.now();
    taps.push(now);
    while (taps.length > 0 && now - taps[0] > 2500) taps.shift();
    if (taps.length >= 5) {
      taps.length = 0;
      onOpen();
    }
  };
  window.addEventListener('pointerdown', handler);
  return () => window.removeEventListener('pointerdown', handler);
}
