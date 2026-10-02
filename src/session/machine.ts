// src/session/machine.ts — pure session state machine: dispatch(event) → Effect[].
// No React, no timers, no I/O: the app owns timers, socket, audio and the avatar,
// and executes the effects this machine returns.

import type { AvatarStateName, SessionEndReason } from '../protocol';

export type SessionState =
  | 'attract' | 'notice' | 'greet' | 'consent'
  | 'q1' | 'q2' | 'q3' | 'close' | 'reset';

export type TurnPhase = 'idle' | 'speaking' | 'can_answer' | 'answering' | 'waiting_response';

export type MachineEvent =
  | { type: 'APPROACH' } | { type: 'LEFT_SPOT' } | { type: 'ON_SPOT' } | { type: 'DWELL' }
  | { type: 'SOCKET_OPEN' } | { type: 'SESSION_STARTED'; sessionId: string } | { type: 'SOCKET_FAILED' }
  | { type: 'BUTTON_DOWN' } | { type: 'BUTTON_UP' }
  | { type: 'SPEAK_START'; line: { line_id: string; text: string; cached: boolean; audio_name?: string } }
  | { type: 'SPEAK_END'; lineId: string }
  | { type: 'QR'; qr: { url: string; png_b64: string; expires_in_s: number } }
  | { type: 'SESSION_ENDED'; reason: SessionEndReason }
  | { type: 'ERROR'; code: string; message: string; recoverable: boolean }
  | { type: 'WALK_TIMEOUT' } | { type: 'SPOT_BACK' } | { type: 'STILL_THERE_TIMEOUT' }
  | { type: 'ANSWER_TIMEOUT' } | { type: 'SESSION_TIMEOUT' } | { type: 'RESET_DONE' } | { type: 'SKIP' };

export type Effect =
  | { type: 'OPEN_SOCKET' } | { type: 'SEND_START' } | { type: 'SEND_UTTERANCE_END' }
  | { type: 'SEND_END'; reason: SessionEndReason } | { type: 'CLOSE_SOCKET' }
  | { type: 'PLAY_CACHED'; name: string } // /audio/<name>.wav — name comes from speak.start audio_name
  | { type: 'START_MIC' }
  | { type: 'STOP_MIC' }
  | { type: 'STOP_PLAYBACK' } | { type: 'AVATAR_LOCAL'; state: AvatarStateName }
  | { type: 'SHOW_CAPTION'; text: string } | { type: 'CLEAR_CAPTION' }
  | { type: 'SHOW_QR'; qr: { url: string; png_b64: string; expires_in_s: number } } | { type: 'HIDE_QR' }
  | { type: 'SHOW_STILL_THERE' } | { type: 'HIDE_STILL_THERE' }
  | { type: 'SHOW_ERROR'; message: string } | { type: 'RELOAD' };

export interface Machine {
  readonly state: SessionState;
  readonly turn: TurnPhase;
  readonly qIndex: number;
  readonly sessionsCompleted: number;
  readonly sessionId: string | null;
  dispatch(e: MachineEvent): Effect[];
  noteRelease(): void;
  firstAudioMs(): number | null;
}

const Q_STATES: SessionState[] = ['q1', 'q2', 'q3'];

export function createMachine(): Machine {
  let state: SessionState = 'attract';
  let turn: TurnPhase = 'idle';
  let sessionId: string | null = null;
  let sessionsCompleted = 0;
  let answersGiven = 0;
  let currentLineId: string | null = null;
  let releaseAt: number | null = null;

  function enterGreet(next: Effect[]): Effect[] {
    state = 'greet'; turn = 'idle';
    sessionId = null; answersGiven = 0; currentLineId = null; releaseAt = null;
    return next;
  }

  function endToAttract(fx: Effect[]): Effect[] {
    state = 'attract'; turn = 'idle'; currentLineId = null;
    return fx;
  }

  // ponytail: one error policy for every live state — recoverable shows, fatal or
  // VERSION_MISMATCH reloads. The version rule is a global protocol interpretation.
  function onError(e: Extract<MachineEvent, { type: 'ERROR' }>): Effect[] {
    if (!e.recoverable || e.code === 'VERSION_MISMATCH')
      return [{ type: 'SHOW_ERROR', message: e.message }, { type: 'RELOAD' }];
    return [{ type: 'SHOW_ERROR', message: e.message }];
  }

  // ponytail: the walkaway sub-flow is identical in greet/consent/q1..q3 ("as in greet").
  function onWalk(e: MachineEvent): Effect[] | null {
    if (e.type === 'WALK_TIMEOUT') return [{ type: 'SHOW_STILL_THERE' }];
    if (e.type === 'SPOT_BACK') return [{ type: 'HIDE_STILL_THERE' }];
    if (e.type === 'STILL_THERE_TIMEOUT')
      return endToAttract([
        { type: 'SEND_END', reason: 'walkaway' },
        { type: 'CLOSE_SOCKET' },
        { type: 'AVATAR_LOCAL', state: 'dormant' },
        { type: 'HIDE_STILL_THERE' },
        { type: 'CLEAR_CAPTION' },
      ]);
    return null;
  }

  function onQuestion(e: MachineEvent): Effect[] {
    if (e.type === 'BUTTON_UP' || e.type === 'ANSWER_TIMEOUT') {
      if (turn !== 'answering') return [];
      turn = 'waiting_response';
      noteRelease();
      answersGiven++;
      return [{ type: 'STOP_MIC' }, { type: 'SEND_UTTERANCE_END' }];
    }
    if (e.type === 'SPEAK_START') {
      if (turn !== 'waiting_response') return [];
      turn = 'speaking';
      currentLineId = e.line.line_id;
      const fx: Effect[] = [{ type: 'SHOW_CAPTION', text: e.line.text }];
      if (e.line.cached)
        fx.push({ type: 'PLAY_CACHED', name: e.line.audio_name ?? (answersGiven >= 3 ? 'goodbye' : 'fallback') });
      return fx;
    }
    if (e.type === 'SPEAK_END') {
      if (turn === 'speaking' && e.lineId === currentLineId) {
        turn = 'can_answer';
        currentLineId = null;
      }
      return [];
    }
    if (e.type === 'BUTTON_DOWN') {
      if (turn === 'speaking') {
        // barge-in: same question; the app drops queued chunks of the superseded line
        turn = 'answering';
        currentLineId = null;
        return [{ type: 'STOP_PLAYBACK' }, { type: 'START_MIC' }];
      }
      if (turn === 'can_answer') {
        turn = 'answering';
        // ponytail: each new answer turn advances the question, clamped at q3 —
        // the backend may ask follow-ups while the client stays in q3.
        if (state === 'q1') state = 'q2';
        else if (state === 'q2') state = 'q3';
        return [{ type: 'START_MIC' }];
      }
      return [];
    }
    if (e.type === 'QR') {
      state = 'close'; turn = 'idle'; currentLineId = null;
      return [{ type: 'SHOW_QR', qr: e.qr }, { type: 'STOP_MIC' }];
    }
    if (e.type === 'SESSION_ENDED') {
      state = 'reset'; turn = 'idle';
      return [
        { type: 'CLOSE_SOCKET' },
        { type: 'STOP_MIC' },
        { type: 'AVATAR_LOCAL', state: 'goodbye' },
        { type: 'CLEAR_CAPTION' },
      ];
    }
    if (e.type === 'SKIP')
      return endToAttract([
        { type: 'SEND_END', reason: 'user_skip' },
        { type: 'CLOSE_SOCKET' },
        { type: 'STOP_MIC' },
        { type: 'STOP_PLAYBACK' },
        { type: 'AVATAR_LOCAL', state: 'dormant' },
        { type: 'CLEAR_CAPTION' },
        { type: 'HIDE_STILL_THERE' },
      ]);
    if (e.type === 'SESSION_TIMEOUT')
      return endToAttract([
        { type: 'SEND_END', reason: 'timeout' },
        { type: 'CLOSE_SOCKET' },
        { type: 'STOP_MIC' },
        { type: 'AVATAR_LOCAL', state: 'dormant' },
        { type: 'CLEAR_CAPTION' },
        { type: 'HIDE_STILL_THERE' },
      ]);
    if (e.type === 'ERROR') return onError(e);
    // Socket died mid-question: the session can't continue (one socket per
    // session); clean up locally and return to attract. No SEND_END — the
    // socket is already dead.
    if (e.type === 'SOCKET_FAILED')
      return endToAttract([
        { type: 'CLOSE_SOCKET' },
        { type: 'STOP_MIC' },
        { type: 'STOP_PLAYBACK' },
        { type: 'AVATAR_LOCAL', state: 'dormant' },
        { type: 'CLEAR_CAPTION' },
        { type: 'HIDE_STILL_THERE' },
      ]);
    return onWalk(e) ?? [];
  }

  function onConnected(e: MachineEvent): Effect[] {
    // shared by greet + consent
    if (e.type === 'SOCKET_FAILED')
      return endToAttract([
        { type: 'CLOSE_SOCKET' },
        { type: 'AVATAR_LOCAL', state: 'dormant' },
        { type: 'CLEAR_CAPTION' },
      ]);
    if (e.type === 'ERROR') return onError(e);
    return onWalk(e) ?? [];
  }

  function dispatch(e: MachineEvent): Effect[] {
    switch (state) {
      case 'attract':
        if (e.type === 'APPROACH') {
          state = 'notice'; turn = 'idle';
          return [{ type: 'AVATAR_LOCAL', state: 'stirring' }];
        }
        // vision-failed fallback: the app only forwards this when vision is down
        if (e.type === 'BUTTON_DOWN')
          return enterGreet([
            { type: 'AVATAR_LOCAL', state: 'wake' },
            { type: 'OPEN_SOCKET' },
          ]);
        return [];
      case 'notice':
        if (e.type === 'LEFT_SPOT') {
          state = 'attract'; turn = 'idle';
          return [{ type: 'AVATAR_LOCAL', state: 'dormant' }];
        }
        if (e.type === 'DWELL')
          return enterGreet([
            { type: 'AVATAR_LOCAL', state: 'wake' },
            { type: 'OPEN_SOCKET' },
          ]);
        return []; // ON_SPOT → no-op
      case 'greet': {
        if (e.type === 'SOCKET_OPEN') return [{ type: 'SEND_START' }];
        if (e.type === 'SESSION_STARTED') { sessionId = e.sessionId; return []; }
        if (e.type === 'SPEAK_START') {
          state = 'consent'; turn = 'speaking'; currentLineId = e.line.line_id;
          const fx: Effect[] = [{ type: 'SHOW_CAPTION', text: e.line.text }];
          if (e.line.cached) fx.push({ type: 'PLAY_CACHED', name: e.line.audio_name ?? 'greeting' });
          return fx;
        }
        return onConnected(e);
      }
      case 'consent': {
        if (e.type === 'BUTTON_DOWN') {
          // consent action: visitor holds the button and says "hi"; the backend
          // treats the first audio activity as consent, then asks Q1.
          // STOP_PLAYBACK barges the greeting if it is still playing.
          state = 'q1'; turn = 'answering';
          return [{ type: 'STOP_PLAYBACK' }, { type: 'START_MIC' }];
        }
        if (e.type === 'SPEAK_END' && e.lineId === currentLineId) {
          turn = 'can_answer';
          currentLineId = null;
          return [];
        }
        return onConnected(e);
      }
      case 'q1':
      case 'q2':
      case 'q3':
        return onQuestion(e);
      case 'close':
        if (e.type === 'SOCKET_FAILED')
          return endToAttract([
            { type: 'CLOSE_SOCKET' },
            { type: 'STOP_PLAYBACK' },
            { type: 'AVATAR_LOCAL', state: 'dormant' },
            { type: 'CLEAR_CAPTION' },
            { type: 'HIDE_QR' },
          ]);
        if (e.type === 'SESSION_ENDED') {
          state = 'reset'; turn = 'idle';
          return [
            { type: 'CLOSE_SOCKET' },
            { type: 'AVATAR_LOCAL', state: 'goodbye' },
            { type: 'CLEAR_CAPTION' },
          ];
        }
        if (e.type === 'SKIP')
          return endToAttract([
            { type: 'SEND_END', reason: 'user_skip' },
            { type: 'CLOSE_SOCKET' },
            { type: 'AVATAR_LOCAL', state: 'dormant' },
            { type: 'HIDE_QR' },
          ]);
        if (e.type === 'ERROR') return onError(e);
        return [];
      case 'reset':
        if (e.type === 'RESET_DONE') {
          state = 'attract'; turn = 'idle';
          sessionsCompleted++;
          return [
            { type: 'AVATAR_LOCAL', state: 'dormant' },
            { type: 'HIDE_QR' },
          ];
        }
        return [];
    }
  }

  function noteRelease(): void {
    releaseAt = performance.now();
  }

  function firstAudioMs(): number | null {
    if (releaseAt === null) return null;
    const ms = performance.now() - releaseAt;
    releaseAt = null; // one-shot: the app sends metrics.latency once per utterance
    return ms;
  }

  return {
    get state() { return state; },
    get turn() { return turn; },
    get qIndex() { return Q_STATES.indexOf(state); },
    get sessionsCompleted() { return sessionsCompleted; },
    get sessionId() { return sessionId; },
    dispatch,
    noteRelease,
    firstAudioMs,
  };
}
