// Build the app bundle with React 16 entry point
const result = await Bun.build({
  entrypoints: ['./src/index.react16.tsx'],
  outdir: './dist',
  target: 'browser',
  format: 'esm',
  sourcemap: 'external',
});

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}

console.log('Initial build complete (React 16 mode)');

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/') {
      return new Response(Bun.file('./index.html'), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.pathname.startsWith('/dist/')) {
      const file = Bun.file('.' + url.pathname);
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': 'application/javascript' },
        });
      }
    }

    const file = Bun.file('.' + url.pathname);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port} (React 16 mode)`);
