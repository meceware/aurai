'use client';

// Last resort when the root layout itself fails, so it cannot rely on the app's styles or
// providers. Kept small and self-contained.
export default function GlobalError({ reset }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#141414', color: '#f2f2f2', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ textAlign: 'center', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Aurai could not load</h1>
          <p style={{ color: '#a3a3a3', marginBottom: '1.5rem' }}>Something went wrong on our side. Your photos are safe.</p>
          <button type="button" onClick={reset} style={{ padding: '0.6rem 1.2rem', borderRadius: '0.5rem', border: 0, background: '#f2f2f2', color: '#141414', fontWeight: 600, cursor: 'pointer' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
