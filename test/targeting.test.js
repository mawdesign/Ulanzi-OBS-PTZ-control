// Seam tests for ticket #6: camera targeting (selected by default, or pinned) and the live camera list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRig } from './support/rig.js';
import { fakeTimers } from './support/fake-timers.js';
import { waitFor } from './support/wait.js';

const lists = (rig, ctx) => rig.studio.commands('sendToPropertyInspector', ctx).map((m) => m.payload).filter((p) => p.type === 'devices');
const last = (xs) => xs[xs.length - 1];

test('the inspector requests the camera list and receives names and identifiers', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const pi = rig.studio.add('stop');

  rig.studio.sendToPlugin(pi, { type: 'getDevices' });
  await waitFor(() => lists(rig, pi).some((p) => p.devices.length === 2), 'camera list');
  const list = last(lists(rig, pi));
  assert.deepEqual(list.devices.map(({ device, name }) => ({ device, name })), [
    { device: 'cam-uuid-1', name: 'Camera 1' },
    { device: 'cam-uuid-2', name: 'Camera 2' },
  ]);
  assert.equal(list.selected, 'cam-uuid-1');
});

test('default target is "selected"; a pinned key sends to the pinned camera only', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const follow = rig.studio.add('stop', { key: '0_0' });
  const pinned = rig.studio.add('stop', { key: '0_1', param: { device: 'cam-uuid-2' } });

  rig.studio.run(follow);
  rig.studio.run(pinned);
  await waitFor(() => rig.obs.requests.filter((r) => r.requestType === 'ptz_stop').length === 2, 'two stops');
  const devices = rig.obs.requests.filter((r) => r.requestType === 'ptz_stop').map((r) => r.requestData.device).sort();
  assert.deepEqual(devices, ['cam-uuid-2', 'selected']);
});

test('adding, removing and reselecting cameras in OBS updates the list sent to the inspector', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const pi = rig.studio.add('stop');
  rig.studio.sendToPlugin(pi, { type: 'getDevices' });
  await waitFor(() => lists(rig, pi).some((p) => p.devices.length === 2), 'initial list');

  rig.obs.addDevice({ device: 'cam-uuid-3', name: 'Camera 3', source: 'Cam3', api: { major: 0, minor: 10 } });
  await waitFor(() => last(lists(rig, pi)).devices.length === 3, 'camera added');
  assert.ok(last(lists(rig, pi)).devices.some((d) => d.device === 'cam-uuid-3' && d.name === 'Camera 3'));

  rig.obs.select('cam-uuid-2');
  await waitFor(() => last(lists(rig, pi)).selected === 'cam-uuid-2', 'selection changed');

  rig.obs.removeDevice('cam-uuid-3');
  await waitFor(() => last(lists(rig, pi)).devices.length === 2, 'camera removed');
});

test('a key pinned to a camera that disappears raises an alert and the plugin keeps working', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const pinned = rig.studio.add('stop', { key: '0_0', param: { device: 'cam-uuid-2' } });
  const follow = rig.studio.add('stop', { key: '0_1' });

  rig.obs.removeDevice('cam-uuid-2');
  rig.studio.run(pinned);
  await waitFor(() => rig.studio.commands('showAlert', pinned).length === 1, 'alert on the pinned key');

  rig.obs.select('cam-uuid-1');
  rig.studio.run(follow);
  await waitFor(() => rig.obs.requests.some((r) => r.requestData.device === 'selected'), 'selected-camera stop still works');
  assert.equal(rig.studio.commands('showAlert', follow).length, 0);
});

test('an inspector opened while OBS is unreachable gets the list once OBS is back', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({ timers: clock.timers });
  t.after(() => rig.stop());
  const port = rig.obs.port;
  const pi = rig.studio.add('stop');
  await rig.obs.stop();
  await waitFor(() => clock.pendingCount === 1, 'retry scheduled');

  rig.studio.sendToPlugin(pi, { type: 'getDevices' });
  await waitFor(() => lists(rig, pi).length >= 1, 'a reply while disconnected');
  assert.deepEqual(last(lists(rig, pi)).devices, []);
  assert.equal(last(lists(rig, pi)).connected, false);

  await rig.obs.start(port);
  clock.fire();
  await waitFor(() => last(lists(rig, pi)).devices.length === 2, 'list after reconnect');
  assert.equal(last(lists(rig, pi)).connected, true);
});

test('deselecting the camera in OBS reports an empty selection to the inspector', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const pi = rig.studio.add('stop');
  rig.studio.sendToPlugin(pi, { type: 'getDevices' });
  await waitFor(() => last(lists(rig, pi))?.selected === 'cam-uuid-1', 'initial selection');

  rig.obs.select(null);
  await waitFor(() => last(lists(rig, pi)).selected === '', 'empty selection');
  assert.equal(last(lists(rig, pi)).devices.length, 2, 'cameras are still listed');
});
