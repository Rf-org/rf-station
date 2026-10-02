
import { useState } from 'react';
import type { CSSProperties } from 'react';

// ponytail: one overlay, two modes (register vs status), DEV-only inject section.

export interface StaffPanelProps {
  open: boolean;
  onClose(): void;
  station: { station_id: string; token: string } | null;
  forceRegister: boolean;
  visionStatus: string;
  versions: { app: string; consent: string; qb: string };
  muted: boolean;
  onToggleMute(): void;
  onRegister(code: string): Promise<void>;
  onSkip(): void;
  onRecalibrate(): void;
  onInjectTranscript?(text: string): void; // DEV only
}

const btn: CSSProperties = {
  display: 'block',
  width: '100%',
  margin: '8px 0',
  padding: '14px',
  fontSize: 18,
  fontWeight: 700,
  background: '#ffb347',
  color: '#0b0906',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
};

export function StaffPanel(props: StaffPanelProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inject, setInject] = useState('');

  if (!props.open) return null;

  const needsRegister = props.forceRegister || !props.station;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await props.onRegister(code.trim());
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Staff panel"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,9,6,0.97)',
        color: '#f5ead9',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: 'min(560px, 92vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ color: '#ffb347', margin: '0 0 16px' }}>Staff</h2>

        {needsRegister ? (
          <div>
            <p style={{ fontSize: 18 }}>Enter the station pairing code:</p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              aria-label="Station pairing code"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 14,
                fontSize: 22,
                borderRadius: 10,
                border: '2px solid #ffb347',
                background: '#1a140d',
                color: '#f5ead9',
              }}
            />
            <button type="button" onClick={() => void submit()} disabled={busy || !code.trim()} style={btn}>
              {busy ? 'Registering…' : 'Register'}
            </button>
            {error && (
              <p role="alert" style={{ color: '#ff8a8a', fontSize: 16 }}>
                {error}
              </p>
            )}
          </div>
        ) : (
          <div>
            <dl style={{ fontSize: 18, lineHeight: 1.7, margin: '0 0 12px' }}>
              <div>
                <dt style={{ display: 'inline', color: '#ffb347' }}>Station:&nbsp;</dt>
                <dd style={{ display: 'inline', margin: 0 }}>{props.station?.station_id}</dd>
              </div>
              <div>
                <dt style={{ display: 'inline', color: '#ffb347' }}>Vision:&nbsp;</dt>
                <dd style={{ display: 'inline', margin: 0 }}>{props.visionStatus}</dd>
              </div>
              <div>
                <dt style={{ display: 'inline', color: '#ffb347' }}>Versions:&nbsp;</dt>
                <dd style={{ display: 'inline', margin: 0 }}>
                  app {props.versions.app} · consent {props.versions.consent} · qb {props.versions.qb}
                </dd>
              </div>
            </dl>
            <button type="button" onClick={props.onSkip} style={btn}>
              Skip session
            </button>
            <button type="button" onClick={props.onRecalibrate} style={btn}>
              Recalibrate floor spot
            </button>
            <button type="button" onClick={props.onToggleMute} style={btn}>
              {props.muted ? 'Unmute audio' : 'Mute audio'}
            </button>
          </div>
        )}

        {import.meta.env.DEV && props.onInjectTranscript && (
          <div style={{ marginTop: 24, borderTop: '1px solid #4a3a22', paddingTop: 16 }}>
            <h3 style={{ color: '#ffb347', margin: '0 0 8px' }}>DEV only</h3>
            <input
              type="text"
              value={inject}
              onChange={(e) => setInject(e.target.value)}
              aria-label="Transcript to inject"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 12,
                fontSize: 18,
                borderRadius: 10,
                border: '1px solid #4a3a22',
                background: '#1a140d',
                color: '#f5ead9',
              }}
            />
            <button
              type="button"
              style={btn}
              onClick={() => {
                props.onInjectTranscript?.(inject);
                setInject('');
              }}
            >
              Inject transcript
            </button>
          </div>
        )}

        <button type="button" onClick={props.onClose} style={{ ...btn, background: '#4a3a22', color: '#f5ead9' }}>
          Close
        </button>
      </div>
    </div>
  );
}
