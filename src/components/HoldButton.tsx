
// ponytail: pointer events + capture; the physical USB button is keyboard-driven globally.
export function HoldButton({
  onPress,
  onRelease,
  label,
}: {
  onPress(): void;
  onRelease(): void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        bottom: '4vh',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(38vw, 260px)',
        aspectRatio: '1',
        borderRadius: '50%',
        border: 'none',
        background: '#ffb347',
        color: '#0b0906',
        fontSize: 'clamp(20px, 2.4vw, 32px)',
        fontWeight: 800,
        cursor: 'pointer',
        touchAction: 'none',
        userSelect: 'none',
        zIndex: 30,
      }}
    >
      {label}
    </button>
  );
}
