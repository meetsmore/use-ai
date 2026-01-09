import { defineConfig } from 'tsup';

export default defineConfig([
  // Unbundled (default) - tree-shakeable, smaller if consumer has deps
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: {
      compilerOptions: {
        composite: false,
      },
    },
    clean: true,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    sourcemap: true,
  },
  // Bundled - self-contained, no transitive dependency issues
  {
    entry: { bundled: 'src/index.ts' },
    format: ['esm'],
    clean: false,
    noExternal: [/.*/],
    platform: 'browser',
    sourcemap: true,
    esbuildOptions(options) {
      options.external = [
        'react',
        'react-dom',
        'react/jsx-runtime',
      ]
    },
  },
]);
