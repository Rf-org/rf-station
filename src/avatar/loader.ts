import { createFallbackAvatar } from './fallback';

// Never drive pixels directly — the ThumpSM rig is driven ONLY through these
// three named inputs (see motoverse-thump-state-sheet-rive-brief.md, v2 note).
export interface AvatarHandle {
  setState(n: number): void;
  setEmotion(n: number): void;
  setWarmth(x: number): void;
  dispose(): void;
}

export interface AvatarLoad {
  handle: AvatarHandle;
  fallback: boolean;
}

const SM = 'ThumpSM';
const RIV_URL = new URL('../../rive/thump.riv?url', import.meta.url).href;

type NumberInput = { value: number | boolean };
type Inputs = { state: NumberInput; emotion: NumberInput; warmth: NumberInput };

export async function loadAvatar(canvas: HTMLCanvasElement): Promise<AvatarLoad> {
  try {
    const { Rive, Layout, Fit, Alignment } = await import('@rive-app/canvas');
    let rive: InstanceType<typeof Rive> | undefined;
    const inputs = await new Promise<Inputs>((resolve, reject) => {
      rive = new Rive({
        src: RIV_URL,
        canvas,
        stateMachines: SM,
        autoplay: true,
        layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
        onLoad: () => {
          // ponytail: cap DPR — the kiosk mini-PC's integrated GPU must hold 60fps.
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const box = canvas.getBoundingClientRect();
          canvas.width = Math.max(1, Math.round(box.width * dpr));
          canvas.height = Math.max(1, Math.round(box.height * dpr));
          rive!.resizeDrawingSurfaceToCanvas();
          const found = rive!.stateMachineInputs(SM) ?? [];
          const pick = (n: string) => found.find((i) => i.name === n) as NumberInput | undefined;
          const state = pick('state');
          const emotion = pick('emotion');
          const warmth = pick('warmth');
          if (!state || !emotion || !warmth) {
            rive!.cleanup();
            reject(new Error('missing ThumpSM inputs'));
            return;
          }
          resolve({ state, emotion, warmth });
        },
        onLoadError: () => reject(new Error('rive load failed')),
      });
    });
    return {
      handle: {
        setState: (n) => {
          inputs.state.value = n;
        },
        setEmotion: (n) => {
          inputs.emotion.value = n;
        },
        setWarmth: (x) => {
          inputs.warmth.value = x;
        },
        dispose: () => rive?.cleanup(),
      },
      fallback: false,
    };
  } catch {
    // Any failure (import, fetch, init, missing inputs) → always show something.
    return { handle: createFallbackAvatar(canvas), fallback: true };
  }
}
