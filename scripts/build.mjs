// Builds dist/com.ulanzi.obsptz.ulanziPlugin/ : static package files + one bundled plugin/app.js.
import { build } from 'esbuild';
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PLUGIN_DIR = 'com.ulanzi.obsptz.ulanziPlugin';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', PLUGIN_DIR);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'package'), out, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/plugin/app.js')],
  outfile: path.join(out, 'plugin/app.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // ws's optional native speedups are not needed; keep them out of the bundle.
  external: ['bufferutil', 'utf-8-validate'],
  // bundled CJS deps (ws) need require() inside an ESM bundle
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});

console.log(`Built ${path.relative(root, out)}`);
