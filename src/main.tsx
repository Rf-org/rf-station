import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './app/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline: attract-only idle screen + pre-recorded fixed lines come from the SW cache.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('sw register failed', e));
}

// Keep the display awake; re-request when the page becomes visible again.
async function lockScreen() {
  try {
    await (navigator as Navigator & { wakeLock?: { request(s: string): Promise<unknown> } }).wakeLock?.request('screen');
  } catch {
    /* kiosk OS policy should also disable sleep; this is best-effort */
  }
}
lockScreen();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lockScreen();
});
