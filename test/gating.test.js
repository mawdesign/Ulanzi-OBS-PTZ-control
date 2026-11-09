// Seam tests for ticket #7: API version gating and feature gating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRig } from './support/rig.js';
import { FULL_FEATURES } from './support/fake-obs.js';
import { waitFor, settle } from './support/wait.js';

const targetOf = (rig, pi) => rig.studio.commands('sendToPropertyInspector', pi).map((m) => m.payload).filter((p) => p.type === 'devices' && p.target).at(-1)?.target;
const controls = (rig) => rig.obs.requests.map((r) => r.requestType);

async function rigWith(t, tweak) {
  const rig = await startRig({ setupObs: tweak });
  t.after(() => rig.stop());
  return rig;
}

test('a camera on an unsupported API version is refused with a key alert and an inspector message', async (t) => {
  for (const api of [{ major: 0, minor: 9 }, { major: 1, minor: 0 }]) {
    const rig = await rigWith(t, (obs) => { obs.devices[0].api = api; });
    const key = rig.studio.add('stop');
    const pi = rig.studio.add('home', { key: '0_1' });
    rig.studio.sendToPlugin(pi, { type: 'getDevices' });

    rig.studio.run(key);
    await waitFor(() => rig.studio.commands('showAlert', key).length === 1, `alert for API ${api.major}.${api.minor}`);
    await waitFor(() => targetOf(rig, pi)?.ok === false, 'inspector message');
    assert.match(targetOf(rig, pi).message, new RegExp(`${api.major}\\.${api.minor}.*0\\.10`));
    assert.deepEqual(controls(rig), [], 'nothing was sent to the camera');
    assert.equal(rig.obs.discoveryRequests.some((r) => r.requestType === 'ptz_get_state' && r.requestData.device === 'cam-uuid-1'), false, 'no calls beyond listing for an unsupported camera');
  }
});

test('a camera on a newer minor version of major 0 works normally', async (t) => {
  const rig = await rigWith(t, (obs) => { obs.devices[0].api = { major: 0, minor: 12 }; });
  const key = rig.studio.add('stop');
  rig.studio.run(key);
  await waitFor(() => controls(rig).includes('ptz_stop'), 'stop sent');
  assert.equal(rig.studio.commands('showAlert', key).length, 0);
});

test('a missing feature alerts the key and sends nothing; the inspector explains', async (t) => {
  const rig = await rigWith(t, (obs) => { obs.features.set('cam-uuid-1', { ...FULL_FEATURES, home: false }); });
  const key = rig.studio.add('home');
  rig.studio.sendToPlugin(key, { type: 'getDevices' });

  rig.studio.run(key);
  await waitFor(() => rig.studio.commands('showAlert', key).length === 1, 'alert');
  await waitFor(() => targetOf(rig, key)?.ok === false, 'inspector message');
  assert.match(targetOf(rig, key).message, /does not support a home position/);
  await settle();
  assert.deepEqual(controls(rig), []);
});

test('features are re-read when the camera reports different ones', async (t) => {
  const rig = await rigWith(t, () => {});
  const key = rig.studio.add('home');
  rig.studio.sendToPlugin(key, { type: 'getDevices' });
  await waitFor(() => targetOf(rig, key)?.ok === true, 'home supported');

  rig.obs.setFeatures('cam-uuid-1', { ...FULL_FEATURES, home: false });
  await waitFor(() => targetOf(rig, key)?.ok === false, 'home no longer supported');
  rig.studio.run(key);
  await waitFor(() => rig.studio.commands('showAlert', key).length === 1, 'alert');
  assert.deepEqual(controls(rig), []);

  rig.obs.setFeatures('cam-uuid-1', { ...FULL_FEATURES });
  await waitFor(() => targetOf(rig, key)?.ok === true, 'home supported again');
  rig.studio.run(key);
  await waitFor(() => controls(rig).includes('ptz_home_recall'), 'home sent');
});

test('the check follows the camera the key is set to, not another one', async (t) => {
  const rig = await rigWith(t, (obs) => { obs.features.set('cam-uuid-2', { ...FULL_FEATURES, home: false }); });
  const follow = rig.studio.add('home', { key: '0_0' }); // camera 1 is selected
  const pinned = rig.studio.add('home', { key: '0_1', param: { device: 'cam-uuid-2' } });
  rig.studio.run(follow);
  rig.studio.run(pinned);
  await waitFor(() => rig.studio.commands('showAlert', pinned).length === 1, 'pinned camera lacks home');
  await waitFor(() => controls(rig).includes('ptz_home_recall'), 'selected camera home sent');
  assert.equal(rig.studio.commands('showAlert', follow).length, 0);
});
