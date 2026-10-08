export async function register() {
  // Node-only work (SQLite, file system) must not be pulled into the edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { boot } = await import('./lib/boot.js');
    boot();
  }
}
