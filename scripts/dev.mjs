// Symlinks dist/<plugin> into a plugin directory so Ulanzi Studio (or the SDK simulator) loads it.
// Usage: ULANZI_PLUGINS_DIR=/path/to/plugins npm run dev
import { symlink, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLUGIN_DIR = 'com.ulanzi.obsptz.ulanziPlugin';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.ULANZI_PLUGINS_DIR;

if (!target) {
  console.error('Set ULANZI_PLUGINS_DIR to the Ulanzi Studio (or UlanziDeckSimulator/plugins) plugin folder.');
  process.exit(1);
}
await stat(target); // throws if missing

const link = path.join(target, PLUGIN_DIR);
await rm(link, { recursive: true, force: true });
await symlink(path.join(root, 'dist', PLUGIN_DIR), link, 'dir');
console.log(`Linked ${link} -> dist/${PLUGIN_DIR}\nRun "npm run build" after each change.`);
