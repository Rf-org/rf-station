
// ponytail: fire-and-forget POST every 10 s; failures never fatal, just warned.
export function startHeartbeat(httpBase: string, stationId: string, appVersion: string): () => void {
  const beat = () => {
    fetch(`${httpBase}/api/stations/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: stationId, app_version: appVersion }),
    }).catch((err: unknown) => {
      console.warn('[heartbeat] failed:', err);
    });
  };
  beat();
  const id = window.setInterval(beat, 10_000);
  return () => window.clearInterval(id);
}
