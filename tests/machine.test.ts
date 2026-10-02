import { describe, expect, it } from 'vitest';
import { createMachine } from '../src/session/machine';
import type { Machine } from '../src/session/machine';

function toGreetSpeaking(m: Machine): void {
  m.dispatch({ type: 'APPROACH' });
  m.dispatch({ type: 'DWELL' });
  m.dispatch({ type: 'SOCKET_OPEN' });
  m.dispatch({ type: 'SESSION_STARTED', sessionId: 'sess-1' });
  m.dispatch({ type: 'SPEAK_START', line: { line_id: 'l-greet', text: 'Hey!', cached: true } });
}

function answer(m: Machine): void {
  // full answer turn: press, release, backend line, line end
  m.dispatch({ type: 'BUTTON_DOWN' });
  m.dispatch({ type: 'BUTTON_UP' });
}

describe('happy path', () => {
  it('attract → notice → greet → consent → q1 → q2 → q3 → close → reset → attract', () => {
    const m = createMachine();
    expect(m.state).toBe('attract');

    expect(m.dispatch({ type: 'APPROACH' }))
      .toEqual([{ type: 'AVATAR_LOCAL', state: 'stirring' }]);
    expect(m.state).toBe('notice');

    expect(m.dispatch({ type: 'DWELL' })).toEqual([
      { type: 'AVATAR_LOCAL', state: 'wake' },
      { type: 'OPEN_SOCKET' },
    ]);
    expect(m.state).toBe('greet');

    expect(m.dispatch({ type: 'SOCKET_OPEN' })).toEqual([{ type: 'SEND_START' }]);
    m.dispatch({ type: 'SESSION_STARTED', sessionId: 'sess-1' });
    expect(m.sessionId).toBe('sess-1');

    // greeting: first cached line of the session
    expect(m.dispatch({
      type: 'SPEAK_START', line: { line_id: 'l-greet', text: 'Hey there!', cached: true },
    })).toEqual([
      { type: 'SHOW_CAPTION', text: 'Hey there!' },
      { type: 'PLAY_CACHED', name: 'greeting' },
    ]);
    expect(m.state).toBe('consent');
    expect(m.turn).toBe('speaking');

    expect(m.dispatch({ type: 'SPEAK_END', lineId: 'l-greet' })).toEqual([]);
    expect(m.turn).toBe('can_answer');

    // consent action: hold button, say "hi" (STOP_PLAYBACK barges a still-playing greeting)
    expect(m.dispatch({ type: 'BUTTON_DOWN' })).toEqual([{ type: 'STOP_PLAYBACK' }, { type: 'START_MIC' }]);
    expect(m.state).toBe('q1');
    expect(m.turn).toBe('answering');
    expect(m.qIndex).toBe(0);

    expect(m.dispatch({ type: 'BUTTON_UP' })).toEqual([
      { type: 'STOP_MIC' },
      { type: 'SEND_UTTERANCE_END' },
    ]);
    expect(m.turn).toBe('waiting_response');

    // latency clock: release → first audible chunk
    const ms = m.firstAudioMs();
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThanOrEqual(0);
    expect(ms!).toBeLessThan(5000);

    // Q1 asked (streamed, not cached)
    expect(m.dispatch({
      type: 'SPEAK_START', line: { line_id: 'l-q1', text: 'What do you ride?', cached: false },
    })).toEqual([{ type: 'SHOW_CAPTION', text: 'What do you ride?' }]);
    expect(m.turn).toBe('speaking');

    // stale line end is ignored
    m.dispatch({ type: 'SPEAK_END', lineId: 'l-old' });
    expect(m.turn).toBe('speaking');

    m.dispatch({ type: 'SPEAK_END', lineId: 'l-q1' });
    expect(m.turn).toBe('can_answer');

    // answer Q1 → q2
    expect(m.dispatch({ type: 'BUTTON_DOWN' })).toEqual([{ type: 'START_MIC' }]);
    expect(m.state).toBe('q2');
    expect(m.qIndex).toBe(1);
    m.dispatch({ type: 'BUTTON_UP' });

    // cached line while answersGiven < 3 → fallback
    expect(m.dispatch({
      type: 'SPEAK_START', line: { line_id: 'l-q2', text: 'Nice one.', cached: true },
    })).toEqual([
      { type: 'SHOW_CAPTION', text: 'Nice one.' },
      { type: 'PLAY_CACHED', name: 'fallback' },
    ]);
    m.dispatch({ type: 'SPEAK_END', lineId: 'l-q2' });

    // answer Q2 → q3
    expect(m.dispatch({ type: 'BUTTON_DOWN' })).toEqual([{ type: 'START_MIC' }]);
    expect(m.state).toBe('q3');
    expect(m.qIndex).toBe(2);
    m.dispatch({ type: 'BUTTON_UP' }); // answersGiven = 3

    // cached line once answersGiven >= 3 → goodbye
    expect(m.dispatch({
      type: 'SPEAK_START', line: { line_id: 'l-bye', text: 'Thanks!', cached: true },
    })).toEqual([
      { type: 'SHOW_CAPTION', text: 'Thanks!' },
      { type: 'PLAY_CACHED', name: 'goodbye' },
    ]);
    m.dispatch({ type: 'SPEAK_END', lineId: 'l-bye' });
    expect(m.turn).toBe('can_answer');

    const qr = { url: 'https://example/q', png_b64: 'abc', expires_in_s: 60 };
    expect(m.dispatch({ type: 'QR', qr })).toEqual([
      { type: 'SHOW_QR', qr },
      { type: 'STOP_MIC' },
    ]);
    expect(m.state).toBe('close');

    expect(m.dispatch({ type: 'SESSION_ENDED', reason: 'completed' })).toEqual([
      { type: 'CLOSE_SOCKET' },
      { type: 'AVATAR_LOCAL', state: 'goodbye' },
      { type: 'CLEAR_CAPTION' },
    ]);
    expect(m.state).toBe('reset');

    expect(m.dispatch({ type: 'RESET_DONE' })).toEqual([
      { type: 'AVATAR_LOCAL', state: 'dormant' },
      { type: 'HIDE_QR' },
    ]);
    expect(m.state).toBe('attract');
    expect(m.sessionsCompleted).toBe(1);
  });
});

describe('walkaway', () => {
  it('still-there prompt → timeout → SEND_END walkaway', () => {
    const m = createMachine();
    toGreetSpeaking(m);
    expect(m.state).toBe('consent');

    expect(m.dispatch({ type: 'WALK_TIMEOUT' }))
      .toEqual([{ type: 'SHOW_STILL_THERE' }]);
    expect(m.state).toBe('consent');

    expect(m.dispatch({ type: 'SPOT_BACK' })).toEqual([{ type: 'HIDE_STILL_THERE' }]);

    m.dispatch({ type: 'WALK_TIMEOUT' });
    expect(m.dispatch({ type: 'STILL_THERE_TIMEOUT' })).toEqual([
      { type: 'SEND_END', reason: 'walkaway' },
      { type: 'CLOSE_SOCKET' },
      { type: 'AVATAR_LOCAL', state: 'dormant' },
      { type: 'HIDE_STILL_THERE' },
      { type: 'CLEAR_CAPTION' },
    ]);
    expect(m.state).toBe('attract');
  });
});

describe('barge-in', () => {
  it('BUTTON_DOWN while speaking → STOP_PLAYBACK + START_MIC, same question', () => {
    const m = createMachine();
    toGreetSpeaking(m);
    m.dispatch({ type: 'SPEAK_END', lineId: 'l-greet' });
    m.dispatch({ type: 'BUTTON_DOWN' }); // q1 answering
    m.dispatch({ type: 'BUTTON_UP' }); // waiting_response
    m.dispatch({
      type: 'SPEAK_START', line: { line_id: 'l-q1', text: 'What do you ride?', cached: false },
    });
    expect(m.turn).toBe('speaking');

    expect(m.dispatch({ type: 'BUTTON_DOWN' })).toEqual([
      { type: 'STOP_PLAYBACK' },
      { type: 'START_MIC' },
    ]);
    expect(m.turn).toBe('answering');
    expect(m.state).toBe('q1');
  });
});

describe('errors', () => {
  it('VERSION_MISMATCH → SHOW_ERROR + RELOAD', () => {
    const m = createMachine();
    toGreetSpeaking(m);
    expect(m.dispatch({
      type: 'ERROR', code: 'VERSION_MISMATCH', message: 'protocol v2 required', recoverable: false,
    })).toEqual([
      { type: 'SHOW_ERROR', message: 'protocol v2 required' },
      { type: 'RELOAD' },
    ]);
  });

  it('recoverable error only shows, stays in state', () => {
    const m = createMachine();
    toGreetSpeaking(m);
    m.dispatch({ type: 'SPEAK_END', lineId: 'l-greet' });
    answer(m);
    expect(m.dispatch({
      type: 'ERROR', code: 'TRANSIENT', message: 'glitch', recoverable: true,
    })).toEqual([{ type: 'SHOW_ERROR', message: 'glitch' }]);
    expect(m.state).toBe('q1');
  });

  it('SOCKET_FAILED drops back to attract', () => {
    const m = createMachine();
    toGreetSpeaking(m);
    expect(m.dispatch({ type: 'SOCKET_FAILED' })).toEqual([
      { type: 'CLOSE_SOCKET' },
      { type: 'AVATAR_LOCAL', state: 'dormant' },
      { type: 'CLEAR_CAPTION' },
    ]);
    expect(m.state).toBe('attract');
  });
});

describe('skip and timeout', () => {
  it('SKIP mid-question → attract with user_skip', () => {
    const m = createMachine();
    toGreetSpeaking(m);
    m.dispatch({ type: 'SPEAK_END', lineId: 'l-greet' });
    answer(m); // q1 answering → waiting_response
    expect(m.dispatch({ type: 'SKIP' })).toEqual([
      { type: 'SEND_END', reason: 'user_skip' },
      { type: 'CLOSE_SOCKET' },
      { type: 'STOP_MIC' },
      { type: 'STOP_PLAYBACK' },
      { type: 'AVATAR_LOCAL', state: 'dormant' },
      { type: 'CLEAR_CAPTION' },
      { type: 'HIDE_STILL_THERE' },
    ]);
    expect(m.state).toBe('attract');
  });

  it('ANSWER_TIMEOUT behaves like BUTTON_UP', () => {
    const m = createMachine();
    toGreetSpeaking(m);
    m.dispatch({ type: 'SPEAK_END', lineId: 'l-greet' });
    m.dispatch({ type: 'BUTTON_DOWN' });
    expect(m.dispatch({ type: 'ANSWER_TIMEOUT' })).toEqual([
      { type: 'STOP_MIC' },
      { type: 'SEND_UTTERANCE_END' },
    ]);
    expect(m.turn).toBe('waiting_response');
  });
});

describe('latency clock', () => {
  it('firstAudioMs returns ms since noteRelease, then null', () => {
    const m = createMachine();
    expect(m.firstAudioMs()).toBeNull();
    m.noteRelease();
    const ms = m.firstAudioMs();
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThanOrEqual(0);
    expect(ms!).toBeLessThan(5000);
    expect(m.firstAudioMs()).toBeNull(); // one-shot
  });
});

describe('cached audio_name', () => {
  it('PLAY_CACHED uses the server audio_name, not the legacy heuristic', () => {
    const m = createMachine();
    m.dispatch({ type: 'APPROACH' });
    m.dispatch({ type: 'DWELL' });
    m.dispatch({ type: 'SOCKET_OPEN' });
    m.dispatch({ type: 'SESSION_STARTED', sessionId: 's' });
    // greeting carries audio_name=greeting
    expect(m.dispatch({
      type: 'SPEAK_START',
      line: { line_id: 'l', text: 'Hey', cached: true, audio_name: 'greeting' },
    })).toEqual([
      { type: 'SHOW_CAPTION', text: 'Hey' },
      { type: 'PLAY_CACHED', name: 'greeting' },
    ]);
    // consent → q1, answer, then a deflect line names its own file
    m.dispatch({ type: 'BUTTON_DOWN' });
    m.dispatch({ type: 'BUTTON_UP' });
    expect(m.dispatch({
      type: 'SPEAK_START',
      line: { line_id: 'l2', text: 'Easy.', cached: true, audio_name: 'deflect_mild' },
    })).toEqual([
      { type: 'SHOW_CAPTION', text: 'Easy.' },
      { type: 'PLAY_CACHED', name: 'deflect_mild' },
    ]);
  });
});
