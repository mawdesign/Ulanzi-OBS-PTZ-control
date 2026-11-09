// Seam tests for ticket #8: Home and Preset keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRig } from './support/rig.js';
import { waitFor } from './support/wait.js';

const lastTarget = (rig, pi) => rig.studio.commands('sendToPropertyInspector', pi).map((m) => m.payload).filter((p) => p.type === 'devices' && p.target).at(-1)?.target;
const presetsOf = (rig, pi) => lastTarget(rig, pi)?.presets;
const controls = (rig) => rig.obs.requests;

async function rigWithPresets(t, setup = () => {}) {
  const rig = await startRig({
    setupObs(obs) {
      obs.presets.set('cam-uuid-1', [{ id: 'p1', name: 'Wide' }, { id: 'p2', name: 'Podium' }]);
      setup(obs);
    },
  });
  t.after(() => rig.stop());
  return rig;
}

test('Home sends the home-recall request to the target camera', async (t) => {
  const rig = await rigWithPresets(t);
  const key = rig.studio.add('home', { param: { device: 'cam-uuid-2' } });
  rig.studio.run(key);
  await waitFor(() => controls(rig).length === 1, 'home sent');
  assert.deepEqual(controls(rig)[0], { requestType: 'ptz_home_recall', requestData: { device: 'cam-uuid-2' } });
  assert.equal(rig.studio.commands('showAlert', key).length, 0);
});

test('the inspector receives preset names and ids in display order', async (t) => {
  const rig = await rigWithPresets(t);
  const pi = rig.studio.add('preset');
  rig.studio.sendToPlugin(pi, { type: 'getDevices' });
  await waitFor(() => presetsOf(rig, pi)?.length === 2, 'preset list');
  assert.deepEqual(presetsOf(rig, pi), [{ id: 'p1', name: 'Wide' }, { id: 'p2', name: 'Podium' }]);
});

test('the preset list refreshes when presets are added, removed, renamed or reordered in OBS', async (t) => {
  const rig = await rigWithPresets(t);
  const pi = rig.studio.add('preset');
  rig.studio.sendToPlugin(pi, { type: 'getDevices' });
  await waitFor(() => presetsOf(rig, pi)?.length === 2, 'initial list');
  const names = () => presetsOf(rig, pi).map((p) => p.name).join(',');

  rig.obs.addPreset('cam-uuid-1', { id: 'p3', name: 'Stage' });
  await waitFor(() => names() === 'Wide,Podium,Stage', 'added');
  rig.obs.renamePreset('cam-uuid-1', 'p2', 'Lectern');
  await waitFor(() => names() === 'Wide,Lectern,Stage', 'renamed');
  rig.obs.reorderPresets('cam-uuid-1', ['p3', 'p1', 'p2']);
  await waitFor(() => names() === 'Stage,Wide,Lectern', 'reordered');
  rig.obs.removePreset('cam-uuid-1', 'p1');
  await waitFor(() => names() === 'Stage,Lectern', 'removed');
});

test('the preset list follows the camera the key is set to', async (t) => {
  const rig = await rigWithPresets(t, (obs) => obs.presets.set('cam-uuid-2', [{ id: 'q1', name: 'Other cam' }]));
  const pi = rig.studio.add('preset');
  rig.studio.sendToPlugin(pi, { type: 'getDevices' });
  await waitFor(() => presetsOf(rig, pi)?.length === 2, 'selected camera presets');
  rig.studio.push({ cmd: 'paramfromapp', ...rig.studio.target(pi), param: { device: 'cam-uuid-2' } });
  await waitFor(() => presetsOf(rig, pi)?.[0]?.id === 'q1', 'pinned camera presets');
});

test('Preset press recalls the stored id', async (t) => {
  const rig = await rigWithPresets(t);
  const key = rig.studio.add('preset', { param: { preset: 'p2' } });
  rig.studio.run(key);
  await waitFor(() => controls(rig).length === 1, 'recall sent');
  assert.deepEqual(controls(rig)[0], { requestType: 'ptz_preset_recall', requestData: { device: 'selected', id: 'p2' } });
});

test('a preset removed in OBS alerts the key on use and sends nothing', async (t) => {
  const rig = await rigWithPresets(t);
  const key = rig.studio.add('preset', { param: { preset: 'p2' } });
  rig.studio.sendToPlugin(key, { type: 'getDevices' });
  await waitFor(() => presetsOf(rig, key)?.length === 2, 'list');
  rig.obs.removePreset('cam-uuid-1', 'p2');
  await waitFor(() => presetsOf(rig, key).length === 1, 'removal seen');

  rig.studio.run(key);
  await waitFor(() => rig.studio.commands('showAlert', key).length === 1, 'alert');
  assert.deepEqual(controls(rig), []);
});

test('a Preset key with no preset chosen alerts', async (t) => {
  const rig = await rigWithPresets(t);
  const key = rig.studio.add('preset');
  rig.studio.run(key);
  await waitFor(() => rig.studio.commands('showAlert', key).length === 1, 'alert');
  assert.deepEqual(controls(rig), []);
});

test('a camera without the presets feature disables the Preset key and is never asked for presets', async (t) => {
  const rig = await rigWithPresets(t, (obs) => obs.features.set('cam-uuid-1', { home: true }));
  const key = rig.studio.add('preset', { param: { preset: 'p1' } });
  rig.studio.sendToPlugin(key, { type: 'getDevices' });
  rig.studio.run(key);
  await waitFor(() => rig.studio.commands('showAlert', key).length === 1, 'alert');
  assert.match(lastTarget(rig, key).message, /does not support presets/);
  assert.equal(rig.obs.discoveryRequests.some((r) => r.requestType === 'ptz_preset_get_list' && r.requestData.device === 'cam-uuid-1'), false);
  assert.deepEqual(controls(rig), []);
});
