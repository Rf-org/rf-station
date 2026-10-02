// ponytail: browser never holds an API key — only the station token.

export interface StoredStation {
  station_id: string;
  token: string;
}

const KEY = 'rf.station.v1';

function isStoredStation(o: unknown): o is StoredStation {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { station_id?: unknown }).station_id === 'string' &&
    typeof (o as { token?: unknown }).token === 'string'
  );
}

export function loadStation(): StoredStation | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredStation(parsed) ? parsed : null;
  } catch {
    return null; // JSON-guarded: corrupt storage reads as absent
  }
}

export async function registerStation(httpBase: string, code: string): Promise<StoredStation> {
  const res = await fetch(`${httpBase}/api/stations/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body: unknown = await res.json();
      if (typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string') {
        detail = (body as { message: string }).message;
      }
    } catch {
      /* keep status as detail */
    }
    throw new Error(`Station registration failed: ${detail}`);
  }
  const station: unknown = await res.json();
  if (!isStoredStation(station)) throw new Error('Station registration failed: bad server response');
  window.localStorage.setItem(KEY, JSON.stringify(station));
  return station;
}

export function clearStation(): void {
  window.localStorage.removeItem(KEY);
}
