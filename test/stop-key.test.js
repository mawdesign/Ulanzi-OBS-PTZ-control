// Seam tests for ticket #2: Stop key end to end, OBS connection and error handling.
// Studio events in (fake Studio) -> main service -> obs-ptz vendor requests out (fake OBS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRig, stored } from './support/rig.js';
import { waitFor, settle } from './support/wait.js';

test('Stop key press sends ptz_stop to the selected camera', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());

  const stop = rig.studio.add('stop');
  rig.studio.run(stop);

  await waitFor(() => rig.obs.requests.length === 1, 'ptz_stop request');
  assert.deepEqual(rig.obs.requests[0], { requestType: 'ptz_stop', requestData: { device: 'selected' } });
  assert.equal(rig.studio.commands('showAlert').length, 0);
});

test('plugin subscribes to vendor events only when identifying to OBS', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  assert.equal(rig.obs.identifies[0].eventSubscriptions, 1 << 9);
});

test('authenticates with the configured password', async (t) => {
  const rig = await startRig({ obsPassword: 's3cret' });
  t.after(() => rig.stop());

  rig.studio.run(rig.studio.add('stop'));
  await waitFor(() => rig.obs.requests.length === 1, 'ptz_stop request');
});

test('Test connection reports success and failure to the inspector', async (t) => {
  const rig = await startRig({ obsPassword: 's3cret' });
  t.after(() => rig.stop());
  const pi = rig.studio.add('stop');
  const settings = { host: '127.0.0.1', port: rig.obs.port };

  rig.studio.sendToPlugin(pi, { type: 'testConnection', settings: { ...settings, password: 'wrong' } });
  await waitFor(() => rig.studio.commands('sendToPropertyInspector', pi).length === 1, 'failure result');
  const failed = rig.studio.commands('sendToPropertyInspector', pi)[0].payload;
  assert.equal(failed.type, 'testConnectionResult');
  assert.equal(failed.ok, false);
  assert.match(failed.message, /auth/i);

  rig.studio.sendToPlugin(pi, { type: 'testConnection', settings: { ...settings, password: 's3cret' } });
  await waitFor(() => rig.studio.commands('sendToPropertyInspector', pi).length === 2, 'success result');
  const ok = rig.studio.commands('sendToPropertyInspector', pi)[1].payload;
  assert.equal(ok.ok, true);
});

test('Test connection reports an unreachable OBS', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const pi = rig.studio.add('stop');

  rig.studio.sendToPlugin(pi, { type: 'testConnection', settings: { host: '127.0.0.1', port: 1, password: '' } });
  await waitFor(() => rig.studio.commands('sendToPropertyInspector', pi).length === 1, 'result');
  assert.equal(rig.studio.commands('sendToPropertyInspector', pi)[0].payload.ok, false);
});

test('wrong password: no stop is sent and the key shows an alert', async (t) => {
  const rig = await startRig({
    obsPassword: 's3cret',
    settings: (base) => stored({ ...base, password: 'wrong' }),
    connectObs: false,
  });
  t.after(() => rig.stop());

  const stop = rig.studio.add('stop');
  await settle();
  rig.studio.run(stop);

  await waitFor(() => rig.studio.commands('showAlert', stop).length === 1, 'alert');
  assert.equal(rig.obs.requests.length, 0);
});

for (const code of ['unknown_device', 'forbidden', 'timeout', 'unavailable']) {
  test(`OBS-PTZ error "${code}" in a response body raises a key alert and the plugin keeps working`, async (t) => {
    const rig = await startRig();
    t.after(() => rig.stop());
    let fail = true;
    rig.obs.on('ptz_stop', () => (fail ? { error: code, message: `simulated ${code}` } : {}));

    const stop = rig.studio.add('stop');
    rig.studio.run(stop);
    await waitFor(() => rig.studio.commands('showAlert', stop).length === 1, 'alert');

    fail = false;
    rig.studio.run(stop);
    await waitFor(() => rig.obs.requests.length === 2, 'second request');
    await settle();
    assert.equal(rig.studio.commands('showAlert', stop).length, 1, 'no further alert');
  });
}

test('no camera selected raises a key alert', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  rig.obs.selected = null;

  const stop = rig.studio.add('stop');
  rig.studio.run(stop);
  await waitFor(() => rig.studio.commands('showAlert', stop).length === 1, 'alert');
});

test('a request OBS never answers times out and raises an alert', async (t) => {
  const rig = await startRig({ requestTimeoutMs: 150 });
  t.after(() => rig.stop());
  rig.obs.silent.add('ptz_stop');

  const stop = rig.studio.add('stop');
  rig.studio.run(stop);
  await waitFor(() => rig.studio.commands('showAlert', stop).length === 1, 'alert after timeout');
});

test('two Stop keys are independent; removing one does not affect the other', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const a = rig.studio.add('stop', { key: '0_0' });
  const b = rig.studio.add('stop', { key: '0_1' });

  rig.studio.clear(a);
  rig.studio.run(a); // removed: ignored
  rig.studio.run(b);

  await waitFor(() => rig.obs.requests.length === 1, 'request from the remaining key');
  await settle();
  assert.equal(rig.obs.requests.length, 1);
  assert.equal(rig.studio.commands('showAlert').length, 0);
});

test('a key pinned to a camera sends its requests to that camera', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const stop = rig.studio.add('stop', { param: { device: 'cam-uuid-9' } });

  rig.studio.run(stop);
  await waitFor(() => rig.obs.requests.length === 1, 'request');
  assert.equal(rig.obs.requests[0].requestData.device, 'cam-uuid-9');
});
