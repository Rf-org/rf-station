// import.meta.env based config. The browser NEVER holds an API key — only the
// station token (from staff registration, kept in localStorage, sent as ?token=).
const env = import.meta.env as Record<string, string | undefined>;

export const config = {
  wsBase: env.VITE_BACKEND_WS ?? 'wss://localhost:8000',
  httpBase: (env.VITE_BACKEND_HTTP ?? 'https://localhost:8000').replace(/\/$/, ''),
  pttKey: env.VITE_PTT_KEY ?? 'Space',
  appVersion: env.VITE_APP_VERSION ?? '0.1.0',
  consentVersion: env.VITE_CONSENT_VERSION ?? '1',
  qbVersion: env.VITE_QB_VERSION ?? '1',
};

export function sessionWsUrl(token: string): string {
  return `${config.wsBase}/ws/session?token=${encodeURIComponent(token)}`;
}
