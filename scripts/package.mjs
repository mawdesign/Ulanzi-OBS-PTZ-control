// Zips the plugin folder into dist/<folder>.zip, the release asset shape the Community Store expects:
// a single top-level <folder>/ containing manifest.json and the bundled plugin/app.js.
// Requires `npm run build` first. Uses the system `zip` (present on macOS and GitHub runners).
import { execFileSync } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLUGIN_DIR = 'com.ulanzi.obsptz.ulanziPlugin';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.PACKAGE_OUT_DIR ? path.resolve(process.env.PACKAGE_OUT_DIR) : path.join(root, 'dist');
const zipPath = path.join(outDir, `${PLUGIN_DIR}.zip`);

await access(path.join(root, PLUGIN_DIR, 'plugin/app.js')).catch(() => {
  console.error('plugin/app.js is missing; run "npm run build" first.');
  process.exit(1);
});

await mkdir(outDir, { recursive: true });
await rm(zipPath, { force: true });
execFileSync('zip', ['-r', '-q', zipPath, PLUGIN_DIR, '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
console.log(`Wrote ${zipPath}`);
