// Push-to-talk: USB button reads as a keyboard key press (matched on e.code).
// The key code is configurable; the app reads it from config.

export interface PttEvents {
  onPress(): void;
  onRelease(): void;
}

/** Bind keydown/keyup for the PTT key. Window blur forces a release (safety: the
 *  button must never stick "held" if focus is lost mid-press). Returns unbind. */
export function bindPushToTalk(key: string, events: PttEvents): () => void {
  let held = false;
  const down = (e: KeyboardEvent) => {
    if (e.code !== key || e.repeat) return;
    e.preventDefault();
    held = true;
    events.onPress();
  };
  const up = (e: KeyboardEvent) => {
    if (e.code !== key || !held) return;
    held = false;
    events.onRelease();
  };
  const onBlur = () => {
    if (!held) return;
    held = false;
    events.onRelease();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', onBlur);
  };
}
