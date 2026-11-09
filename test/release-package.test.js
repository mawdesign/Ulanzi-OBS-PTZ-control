// Verifies the release asset has the shape the Ulanzi Community Store expects:
// <folder>.zip with a single top-level <folder>/ holding manifest.json and the bundled service,
// and no dependency folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER = 'com.ulanzi.obsptz.ulanziPlugin';

test('release zip has the Community Store shape', async (t) => {
  const out = await mkdtemp(path.join(tmpdir(), 'obsptz-pkg-'));
  t.after(() => rm(out, { recursive: true, force: true }));

  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'ignore' });
  execFileSync(process.execPath, ['scripts/package.mjs'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, PACKAGE_OUT_DIR: out },
  });

  const entries = execFileSync('unzip', ['-Z1', path.join(out, `${FOLDER}.zip`)], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  assert.ok(entries.every((e) => e.startsWith(`${FOLDER}/`)), 'single top-level plugin folder');
  assert.ok(entries.includes(`${FOLDER}/manifest.json`));
  assert.ok(entries.includes(`${FOLDER}/plugin/app.js`));
  assert.ok(entries.some((e) => e.startsWith(`${FOLDER}/property-inspector/`)));
  assert.ok(!entries.some((e) => e.includes('node_modules')), 'no dependency folder');
});
