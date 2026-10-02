import { describe, expect, it } from 'vitest';
import { Director, PROTOCOL_TO_RIVE } from '../src/avatar/director';
import type { AvatarHandle } from '../src/avatar/loader';
import type { AvatarStateName, MsgAvatarState } from '../src/protocol';

function fake() {
  const calls: { method: string; value: number }[] = [];
  const handle: AvatarHandle = {
    setState: (n) => calls.push({ method: 'setState', value: n }),
    setEmotion: (n) => calls.push({ method: 'setEmotion', value: n }),
    setWarmth: (x) => calls.push({ method: 'setWarmth', value: x }),
    dispose: () => undefined,
  };
  const last = (m: string) => calls.filter((c) => c.method === m).at(-1)?.value;
  return { calls, handle, last };
}

const expected: [AvatarStateName, number][] = [
  ['dormant', 0], ['stirring', 1], ['wake', 2], ['listening', 3],
  ['thinking', 4], ['speaking', 5], ['error', 7], ['goodbye', 8],
];

describe('PROTOCOL_TO_RIVE', () => {
  it('maps all 8 protocol states, leaving Rive state 6 unmapped', () => {
    expect(Object.entries(PROTOCOL_TO_RIVE).sort()).toEqual(expected.sort());
    expect(Object.values(PROTOCOL_TO_RIVE)).not.toContain(6);
  });
});

describe('Director.remote', () => {
  const remote = (msg: Partial<MsgAvatarState> & { state: AvatarStateName }) => {
    const f = fake();
    new Director(f.handle).remote({ type: 'avatar.state', ...msg } as MsgAvatarState);
    return f;
  };

  it('maps every protocol state to the Rive state number', () => {
    for (const [name, n] of expected) {
      expect(remote({ state: name }).last('setState')).toBe(n);
    }
  });

  it('validates emotion: integer 0..4 else neutral', () => {
    expect(remote({ state: 'listening', emotion: 2 }).last('setEmotion')).toBe(2);
    expect(remote({ state: 'listening', emotion: 5 }).last('setEmotion')).toBe(0);
    expect(remote({ state: 'listening', emotion: -1 }).last('setEmotion')).toBe(0);
    expect(remote({ state: 'listening', emotion: 2.5 }).last('setEmotion')).toBe(0);
    expect(remote({ state: 'listening' }).last('setEmotion')).toBe(0);
  });

  it('clamps warmth to 0..1 and leaves it unchanged when absent', () => {
    expect(remote({ state: 'listening', warmth: 1.5 }).last('setWarmth')).toBe(1);
    expect(remote({ state: 'listening', warmth: -0.2 }).last('setWarmth')).toBe(0);
    expect(remote({ state: 'listening' }).calls.some((c) => c.method === 'setWarmth')).toBe(false);
  });

  it('ignores gaze/glow — never touches the rig with them', () => {
    const f = remote({ state: 'wake', gaze: [0.5, 0.5], glow: 0.9 } as MsgAvatarState);
    expect(f.calls.map((c) => c.method).sort()).toEqual(['setEmotion', 'setState']);
  });
});

describe('Director.local', () => {
  it('maps the same table for pre/post-session control', () => {
    for (const [name, n] of expected) {
      const f = fake();
      new Director(f.handle).local(name);
      expect(f.last('setState')).toBe(n);
    }
  });
});
