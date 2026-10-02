import { useCallback, useEffect, useRef, useState } from 'react';
import { config, sessionWsUrl } from '../config';
import type { ServerMsg } from '../protocol';
import { createMachine, type Effect, type Machine, type MachineEvent } from '../session/machine';
import { SessionSocket, type SocketEvent } from '../websocket/client';
import { VisionManager, type VisionEvent } from '../vision/manager';
import { loadAvatar } from '../avatar/loader';
import { Director } from '../avatar/director';
import { AudioPlayer } from '../audio/playback';
import { startMic, pcm16ToB64, type MicHandle } from '../audio/mic';
import { bindPushToTalk } from '../audio/ptt';
import { Captions } from '../components/Captions';
import { ConsentScreen } from '../components/ConsentScreen';
import { QRDisplay } from '../components/QRDisplay';
import { AttractScreen } from '../components/AttractScreen';
import { ErrorBanner } from '../components/ErrorBanner';
import { HoldButton } from '../components/HoldButton';
import { StaffPanel } from '../staff/StaffPanel';
import { CalibrationOverlay } from '../staff/CalibrationOverlay';
import { bindStaffGesture } from '../staff/gesture';
import { loadStation, registerStation, clearStation, type StoredStation } from '../staff/registration';
import { startHeartbeat } from '../staff/heartbeat';

interface Qr { url: string; png_b64: string; expires_in_s: number }
interface Snap {
  sessionState: string;
  caption: string | null;
  qr: Qr | null;
  stillThere: boolean;
  error: string | null;
  staffOpen: boolean;
  forceRegister: boolean;
  visionStatus: string;
  visionFailed: boolean;
  muted: boolean;
  calibrating: boolean;
  registered: boolean;
  answering: boolean;
}

const ANSWER_MS = 30_000;
const SESSION_MS = 100_000;
const STILL_THERE_MS = 5_000;
const RESET_MS = 3_000;
const IDLE_RELOAD_MS = 2 * 3600_000;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const machineRef = useRef<Machine | null>(null);
  const socketRef = useRef<SessionSocket | null>(null);
  const visionRef = useRef<VisionManager | null>(null);
  const directorRef = useRef<Director | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const micRef = useRef<MicHandle | null>(null);
  const seqRef = useRef(0);
  const lineIdRef = useRef<string | null>(null);
  // Protocol: cached lines carry no speak.audio. If a misbehaving server sends
  // chunks for one anyway, drop them here so the local WAV never double-plays.
  const cachedLinesRef = useRef(new Set<string>());
  const stationRef = useRef<StoredStation | null>(null);
  const heartbeatStopRef = useRef<(() => void) | null>(null);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastActiveRef = useRef(Date.now());

  const [snap, setSnap] = useState<Snap>({
    sessionState: 'attract', caption: null, qr: null, stillThere: false, error: null,
    staffOpen: false, forceRegister: false, visionStatus: 'starting', visionFailed: false,
    muted: false, calibrating: false, registered: false, answering: false,
  });
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const uiRef = useRef({ caption: null as string | null, qr: null as Qr | null, stillThere: false, error: null as string | null });

  const syncSnap = useCallback(() => {
    const m = machineRef.current;
    setSnap((s) => ({
      ...s,
      sessionState: m ? m.state : s.sessionState,
      answering: m ? m.turn === 'answering' : false,
      caption: uiRef.current.caption,
      qr: uiRef.current.qr,
      stillThere: uiRef.current.stillThere,
      error: uiRef.current.error,
    }));
  }, []);

  const later = useCallback((name: string, ms: number, fn: () => void) => {
    const t = timersRef.current.get(name);
    if (t) clearTimeout(t);
    timersRef.current.set(name, setTimeout(() => { timersRef.current.delete(name); fn(); }, ms));
  }, []);
  const clearTimer = useCallback((name: string) => {
    const t = timersRef.current.get(name);
    if (t) { clearTimeout(t); timersRef.current.delete(name); }
  }, []);

  const fire = useCallback((event: MachineEvent) => {
    const m = machineRef.current;
    if (!m) return;
    lastActiveRef.current = Date.now();
    let effects: Effect[];
    try {
      effects = m.dispatch(event);
    } catch (e) {
      console.error('machine dispatch failed', e);
      return;
    }
    for (const fx of effects) executeEffect(fx);
    syncSnap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSnap]);

  const fireRef = useRef(fire);
  fireRef.current = fire;

  function openSocket() {
    const st = stationRef.current ?? loadStation();
    stationRef.current = st;
    if (!st) { setSnap((s) => ({ ...s, staffOpen: true, forceRegister: true })); return; }
    socketRef.current?.disconnect();
    const sock = new SessionSocket(sessionWsUrl(st.token));
    socketRef.current = sock;
    sock.onEvent(handleSocketEvent);
    sock.connect();
  }

  function executeEffect(fx: Effect) {
    const m = machineRef.current!;
    const player = playerRef.current;
    switch (fx.type) {
      case 'OPEN_SOCKET':
        openSocket();
        break;
      case 'SEND_START':
        socketRef.current?.send({
          type: 'session.start', station_id: stationRef.current!.station_id,
          app_version: config.appVersion, consent_version: config.consentVersion, qb_version: config.qbVersion,
        });
        break;
      case 'SEND_UTTERANCE_END':
        socketRef.current?.send({ type: 'utterance.end' });
        m.noteRelease();
        break;
      case 'SEND_END':
        try { socketRef.current?.send({ type: 'session.end', reason: fx.reason }); } catch { /* closing anyway */ }
        break;
      case 'CLOSE_SOCKET':
        socketRef.current?.disconnect();
        socketRef.current = null;
        clearTimer('session');
        break;
      case 'PLAY_CACHED':
        player?.playLocal(fx.name)
          .catch((e) => console.warn('cached line failed', fx.name, e))
          .finally(() => fireRef.current({ type: 'SPEAK_END', lineId: lineIdRef.current ?? '' }));
        break;
      case 'START_MIC':
        seqRef.current = 0;
        startMic((pcm) => {
          const sock = socketRef.current;
          if (!sock) return;
          sock.send({ type: 'audio.chunk', seq: seqRef.current++, pcm16_b64: pcm16ToB64(pcm) });
        }).then((h) => { micRef.current = h; })
          .catch((e) => fireRef.current({ type: 'ERROR', code: 'MIC', message: String(e), recoverable: false }));
        later('answer', ANSWER_MS, () => fireRef.current({ type: 'ANSWER_TIMEOUT' }));
        break;
      case 'STOP_MIC':
        micRef.current?.stop();
        micRef.current = null;
        clearTimer('answer');
        break;
      case 'STOP_PLAYBACK':
        if (lineIdRef.current) player?.stopLine(lineIdRef.current);
        else player?.stopAll();
        break;
      case 'AVATAR_LOCAL':
        directorRef.current?.local(fx.state);
        break;
      case 'SHOW_CAPTION': uiRef.current.caption = fx.text; break;
      case 'CLEAR_CAPTION': uiRef.current.caption = null; break;
      case 'SHOW_QR': uiRef.current.qr = fx.qr; break;
      case 'HIDE_QR': uiRef.current.qr = null; break;
      case 'SHOW_STILL_THERE':
        uiRef.current.stillThere = true;
        later('stillThere', STILL_THERE_MS, () => fireRef.current({ type: 'STILL_THERE_TIMEOUT' }));
        break;
      case 'HIDE_STILL_THERE': uiRef.current.stillThere = false; clearTimer('stillThere'); break;
      case 'SHOW_ERROR': uiRef.current.error = fx.message; break;
      case 'RELOAD': location.reload(); break;
    }
  }

  function handleSocketEvent(e: SocketEvent) {
    const m = machineRef.current;
    if (!m) return;
    switch (e.type) {
      case 'open': fireRef.current({ type: 'SOCKET_OPEN' }); break;
      case 'message': handleServerMsg(e.msg); break;
      case 'closed':
        if (!e.willRetry) {
          // Token rejected: drop it so the reload below boots into registration,
          // not into a 4401 → reload loop.
          clearStation();
          stationRef.current = null;
          fireRef.current({ type: 'ERROR', code: 'TOKEN', message: 'Station token rejected — please re-register this station.', recoverable: false });
        } else {
          fireRef.current({ type: 'SOCKET_FAILED' });
        }
        break;
      case 'error': console.warn('socket error', e.message); break;
    }
  }

  function handleServerMsg(msg: ServerMsg) {
    switch (msg.type) {
      case 'session.started':
        later('session', SESSION_MS, () => fireRef.current({ type: 'SESSION_TIMEOUT' }));
        fireRef.current({ type: 'SESSION_STARTED', sessionId: msg.session_id });
        break;
      case 'avatar.state':
        directorRef.current?.remote(msg);
        break;
      case 'speak.start':
        lineIdRef.current = msg.line_id;
        if (msg.cached) cachedLinesRef.current.add(msg.line_id);
        else cachedLinesRef.current.clear(); // a streamed line supersedes
        fireRef.current({ type: 'SPEAK_START', line: { line_id: msg.line_id, text: msg.text, cached: msg.cached, audio_name: msg.audio_name } });
        break;
      case 'speak.audio': {
        if (msg.line_id !== lineIdRef.current) break; // superseded by barge-in
        if (cachedLinesRef.current.has(msg.line_id)) break; // protocol violation: ignore
        playerRef.current?.feedChunk(msg.line_id, msg.b64, msg.final);
        break;
      }
      case 'qr.show':
        fireRef.current({ type: 'QR', qr: { url: msg.url, png_b64: msg.png_b64, expires_in_s: msg.expires_in_s } });
        break;
      case 'session.ended':
        cachedLinesRef.current.clear();
        fireRef.current({ type: 'SESSION_ENDED', reason: msg.reason });
        break;
      case 'error':
        fireRef.current({ type: 'ERROR', code: msg.code, message: msg.message, recoverable: msg.recoverable });
        break;
      case 'pong': break;
    }
  }

  // ---- boot ---------------------------------------------------------------
  useEffect(() => {
    const machine = createMachine();
    machineRef.current = machine;
    const player = new AudioPlayer();
    playerRef.current = player;
    player.onFirstAudible = () => {
      const ms = machine.firstAudioMs();
      const lineId = lineIdRef.current;
      if (ms !== null && lineId) socketRef.current?.send({ type: 'metrics.latency', line_id: lineId, ms });
    };
    player.onLineEnded = (lineId: string) => {
      if (lineId === lineIdRef.current) fireRef.current({ type: 'SPEAK_END', lineId });
    };

    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      if (canvas && !cancelled) {
        const { handle } = await loadAvatar(canvas);
        if (!cancelled) directorRef.current = new Director(handle);
      }
      const video = videoRef.current;
      if (video && !cancelled) {
        const vision = new VisionManager(video);
        visionRef.current = vision;
        vision.onEvent((ev: VisionEvent) => fireRef.current({ type: ev }));
        try {
          await vision.start();
          if (cancelled) return;
          // No calibrated floor spot → sessions can never start; force staff attention.
          const needsCalibration = !vision.getSpot();
          setSnap((s) => ({
            ...s,
            visionStatus: 'running',
            staffOpen: s.staffOpen || needsCalibration,
          }));
        } catch {
          if (!cancelled) setSnap((s) => ({ ...s, visionStatus: 'failed', visionFailed: true }));
        }
      }
    })();

    const st = loadStation();
    stationRef.current = st;
    setSnap((s) => ({ ...s, registered: !!st, forceRegister: !st, staffOpen: !st }));
    heartbeatStopRef.current = st ? startHeartbeat(config.httpBase, st.station_id, config.appVersion) : null;

    const unbindPtt = bindPushToTalk(config.pttKey, {
      onPress: () => pressRef.current(),
      onRelease: () => releaseRef.current(),
    });
    const unbindGesture = bindStaffGesture(() => setSnap((s) => ({ ...s, staffOpen: true })));

    const idleCheck = setInterval(() => {
      const m = machineRef.current;
      if (m && m.state === 'attract' &&
          (m.sessionsCompleted >= 50 || Date.now() - lastActiveRef.current > IDLE_RELOAD_MS)) {
        location.reload(); // idle only — never mid-session
      }
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(idleCheck);
      unbindPtt();
      unbindGesture();
      heartbeatStopRef.current?.();
      heartbeatStopRef.current = null;
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      micRef.current?.stop();
      socketRef.current?.disconnect();
      visionRef.current?.stop();
      player.stopAll();
      directorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reset → attract after the goodbye beat
  useEffect(() => {
    if (snap.sessionState === 'reset') {
      const t = setTimeout(() => fireRef.current({ type: 'RESET_DONE' }), RESET_MS);
      return () => clearTimeout(t);
    }
  }, [snap.sessionState]);

  const press = useCallback(() => {
    const s = snapRef.current;
    if (s.staffOpen || s.calibrating) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    const m = machineRef.current;
    if (!m) return;
    if (m.state === 'attract' && !s.visionFailed) return; // vision drives; button is fallback only
    fire({ type: 'BUTTON_DOWN' });
  }, [fire]);
  const release = useCallback(() => {
    const s = snapRef.current;
    if (s.staffOpen || s.calibrating) return;
    fire({ type: 'BUTTON_UP' });
  }, [fire]);
  const pressRef = useRef(press);
  const releaseRef = useRef(release);
  pressRef.current = press;
  releaseRef.current = release;

  const doRegister = useCallback(async (code: string) => {
    const st = await registerStation(config.httpBase, code);
    stationRef.current = st;
    heartbeatStopRef.current?.();
    heartbeatStopRef.current = startHeartbeat(config.httpBase, st.station_id, config.appVersion);
    setSnap((s) => ({ ...s, registered: true, forceRegister: false, staffOpen: false }));
    // A visitor may have dwelled while the station was unregistered (greet with no
    // socket): retry the connection now instead of stranding them.
    if (machineRef.current?.state === 'greet') openSocket();
  }, []);

  const toggleMute = useCallback(() => {
    setSnap((s) => {
      playerRef.current?.setMuted(!s.muted);
      return { ...s, muted: !s.muted };
    });
  }, []);

  const injectTranscript = useCallback((text: string) => {
    socketRef.current?.send({ type: 'debug.transcript', text });
  }, []);

  const s = snap;
  const showHold = (s.sessionState === 'q1' || s.sessionState === 'q2' || s.sessionState === 'q3') && !s.staffOpen;

  return (
    <div className="kiosk">
      <div className="avatar-layer">
        <canvas ref={canvasRef} className="avatar" />
      </div>
      <video ref={videoRef} className="vision-src" muted playsInline />

      <div className="ui-layer">
        {s.sessionState === 'attract' && <AttractScreen />}
        {s.sessionState === 'consent' && (
          <div className="screen-center"><ConsentScreen /></div>
        )}
        {s.sessionState === 'close' && s.qr && (
          <div className="screen-center">
            <QRDisplay pngB64={s.qr.png_b64} expiresInS={s.qr.expires_in_s} />
          </div>
        )}
        <Captions text={s.caption} />
        {s.stillThere && <div className="still-there">Still there?</div>}
        <ErrorBanner message={s.error} />
        {showHold && (
          <div className="hold-wrap">
            <HoldButton
              onPress={() => pressRef.current()}
              onRelease={() => releaseRef.current()}
              label={s.answering ? 'Listening…' : 'HOLD TO TALK'}
            />
          </div>
        )}
      </div>

      {s.calibrating && (
        <CalibrationOverlay
          video={videoRef.current}
          initial={visionRef.current?.getSpot() ?? null}
          onDone={(poly) => { visionRef.current?.setSpot(poly); setSnap((p) => ({ ...p, calibrating: false })); }}
          onCancel={() => setSnap((p) => ({ ...p, calibrating: false }))}
        />
      )}

      <StaffPanel
        open={s.staffOpen}
        onClose={() => setSnap((p) => ({ ...p, staffOpen: false, forceRegister: !stationRef.current }))}
        station={stationRef.current}
        forceRegister={s.forceRegister}
        visionStatus={s.visionStatus}
        versions={{ app: config.appVersion, consent: config.consentVersion, qb: config.qbVersion }}
        muted={s.muted}
        onToggleMute={toggleMute}
        onRegister={doRegister}
        onSkip={() => fire({ type: 'SKIP' })}
        onRecalibrate={() => setSnap((p) => ({ ...p, staffOpen: false, calibrating: true }))}
        onInjectTranscript={injectTranscript}
      />
    </div>
  );
}
