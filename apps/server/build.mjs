// Bundles the server and worker (including the workspace packages) into
// self-contained ESM files. Only the native argon2 binding stays external.
import { cp, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });

await build({
  entryPoints: { index: 'src/index.ts', worker: 'src/worker.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  external: ['@node-rs/argon2', 'pg-native', 'bufferutil', 'utf-8-validate', 'pino-pretty'],
  banner: {
    // Some CommonJS dependencies call require(); give them one inside the ESM bundle.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

await cp('src/db/migrations', 'dist/migrations', { recursive: true });
console.log('copied migrations to dist/migrations');

// The bundles are ES modules; say so, wherever dist/ ends up (the Docker image has no other package.json).
await writeFile('dist/package.json', `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
