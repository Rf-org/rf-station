import { describe, expect, it } from 'vitest';
import { parseServerMsg } from '../src/protocol';

describe('parseServerMsg', () => {
  it('accepts every valid server message', () => {
    expect(parseServerMsg({ type: 'session.started', session_id: 's1' }))
      .toEqual({ type: 'session.started', session_id: 's1' });
    expect(parseServerMsg({ type: 'avatar.state', state: 'speaking', emotion: 2, warmth: 0.5 }))
      .toEqual({ type: 'avatar.state', state: 'speaking', emotion: 2, warmth: 0.5 });
    expect(parseServerMsg({
      type: 'speak.start', line_id: 'l1', text: 'Hi', cached: true, audio_name: 'greeting',
    })).toEqual({
      type: 'speak.start', line_id: 'l1', text: 'Hi', cached: true, audio_name: 'greeting',
    });
    expect(parseServerMsg({
      type: 'speak.start', line_id: 'l2', text: 'Hi', cached: false,
    })).toMatchObject({ type: 'speak.start', cached: false });
    expect(parseServerMsg({ type: 'speak.audio', line_id: 'l2', seq: 0, b64: 'AAA=', final: true }))
      .toMatchObject({ type: 'speak.audio', seq: 0, final: true });
    expect(parseServerMsg({ type: 'qr.show', url: 'https://x/y', png_b64: 'AAA=', expires_in_s: 600 }))
      .toMatchObject({ type: 'qr.show', expires_in_s: 600 });
    expect(parseServerMsg({ type: 'session.ended', reason: 'completed' }))
      .toEqual({ type: 'session.ended', reason: 'completed' });
    expect(parseServerMsg({ type: 'error', code: 'E', message: 'm', recoverable: true }))
      .toEqual({ type: 'error', code: 'E', message: 'm', recoverable: true });
    expect(parseServerMsg({ type: 'pong' })).toEqual({ type: 'pong' });
  });

  it('rejects malformed and unknown frames', () => {
    const bad: unknown[] = [
      null, 42, 'pong', [],
      { type: 'nope' },
      { type: 'session.started' }, // missing session_id
      { type: 'session.started', session_id: '' },
      { type: 'avatar.state', state: 'dancing' }, // unknown state
      { type: 'avatar.state', state: 'wake', emotion: 9 }, // emotion out of range
      { type: 'avatar.state', state: 'wake', warmth: 2 },
      { type: 'speak.start', line_id: 'l', text: 'Hi', cached: true }, // cached needs audio_name
      { type: 'speak.start', line_id: 'l', text: 'Hi', cached: true, audio_name: '../evil' },
      { type: 'speak.start', line_id: 'l', text: 'Hi', cached: 'yes' },
      { type: 'speak.audio', line_id: 'l', seq: -1, b64: 'AAA=', final: true },
      { type: 'speak.audio', line_id: 'l', seq: 0, b64: 'AAA=' }, // missing final
      { type: 'qr.show', url: 'https://x', png_b64: 'A', expires_in_s: -5 },
      { type: 'session.ended', reason: 'exploded' },
      { type: 'error', code: 'E', message: 'm' }, // missing recoverable
    ];
    for (const b of bad) expect(parseServerMsg(b), JSON.stringify(b)).toBeNull();
  });

  it('ignores unknown extra fields', () => {
    expect(parseServerMsg({ type: 'pong', extra: [1, 2] })).toEqual({ type: 'pong' });
  });
});
