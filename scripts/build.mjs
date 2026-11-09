// Bundles src/plugin/app.js into the tracked plugin folder as plugin/app.js (gitignored).
// The plugin folder lives at the repo root because the Ulanzi Community Store requires it there.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PLUGIN_DIR = 'com.ulanzi.obsptz.ulanziPlugin';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(root, PLUGIN_DIR);

await rm(path.join(pluginDir, 'plugin'), { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, 'src/plugin/app.js')],
  outfile: path.join(pluginDir, 'plugin/app.js'),
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

console.log(`Built ${PLUGIN_DIR}/plugin/app.js`);
