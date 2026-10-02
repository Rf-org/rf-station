
// ponytail: null-guard + fixed banner, nothing else.
export function ErrorBanner({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: '#7a1f1f',
        color: '#fff',
        fontSize: 24,
        fontWeight: 600,
        textAlign: 'center',
        padding: '14px 16px',
        zIndex: 50,
      }}
    >
      {message}
    </div>
  );
}
