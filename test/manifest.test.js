import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../com.ulanzi.obsptz.ulanziPlugin');
const manifest = JSON.parse(await readFile(path.join(pkg, 'manifest.json'), 'utf8'));
const exists = (p) => access(path.join(pkg, p)).then(() => true, () => false);

test('main UUID has exactly 4 segments', () => {
  assert.equal(manifest.UUID.split('.').length, 4);
});

test('every action UUID is namespaced under the main UUID with 5+ segments', () => {
  for (const a of manifest.Actions) {
    assert.ok(a.UUID.startsWith(`${manifest.UUID}.`), a.UUID);
    assert.ok(a.UUID.split('.').length >= 5, a.UUID);
  }
});

test('action UUIDs are unique', () => {
  const uuids = manifest.Actions.map((a) => a.UUID);
  assert.equal(new Set(uuids).size, uuids.length);
});

test('every action has a normal and a disconnected state', () => {
  for (const a of manifest.Actions) {
    assert.deepEqual(a.States.map((s) => s.Name), ['Normal', 'Disconnected'], a.UUID);
  }
});

test('the dial action is the only Encoder action', () => {
  const enc = manifest.Actions.filter((a) => a.Controllers?.includes('Encoder'));
  assert.deepEqual(enc.map((a) => a.UUID), [`${manifest.UUID}.dial`]);
});

test('referenced files exist in the plugin folder', async () => {
  const paths = [manifest.Icon, manifest.CategoryIcon];
  for (const a of manifest.Actions) {
    paths.push(a.Icon, a.PropertyInspectorPath, ...a.States.map((s) => s.Image));
  }
  for (const p of paths) assert.ok(await exists(p), `missing ${p}`);
});

test('every Move and Zoom direction has an icon file', async () => {
  const { PAN_TILT, ZOOM_DIRECTIONS } = await import('../src/plugin/motion.js');
  for (const d of Object.keys(PAN_TILT)) assert.ok(await exists(`resources/move-${d}.svg`), `move-${d}.svg`);
  for (const d of Object.keys(ZOOM_DIRECTIONS)) assert.ok(await exists(`resources/zoom-${d}.svg`), `zoom-${d}.svg`);
});
