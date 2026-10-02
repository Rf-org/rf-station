import type { AvatarHandle } from './loader';
import type { AvatarStateName, MsgAvatarState } from '../protocol';

// Rive state 6 is intentionally unmapped: per the rig brief it is a base-layer
// no-op while the `emotion` overlay drives the beat. The protocol has no
// emotion-beat state, so the map only covers the 8 protocol states.
export const PROTOCOL_TO_RIVE: Record<AvatarStateName, number> = {
  dormant: 0,
  stirring: 1,
  wake: 2,
  listening: 3,
  thinking: 4,
  speaking: 5,
  error: 7,
  goodbye: 8,
};

// `gaze` and `glow` in MsgAvatarState are IGNORED: ThumpSM has no such inputs
// and the rig brief forbids driving pixels directly — only state/emotion/warmth.
export class Director {
  constructor(private handle: AvatarHandle) {}

  // Pre/post-session local control (session engine owns state mid-session).
  local(state: AvatarStateName): void {
    this.handle.setState(PROTOCOL_TO_RIVE[state]);
  }

  remote(msg: MsgAvatarState): void {
    this.handle.setState(PROTOCOL_TO_RIVE[msg.state]);
    this.handle.setEmotion(validEmotion(msg.emotion));
    if (msg.warmth !== undefined) this.handle.setWarmth(clamp01(msg.warmth));
  }
}

const validEmotion = (e: number | undefined) =>
  Number.isInteger(e) && (e as number) >= 0 && (e as number) <= 4 ? (e as number) : 0;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
