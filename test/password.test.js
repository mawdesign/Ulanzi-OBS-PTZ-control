// Seam tests for ticket #4: the OBS password is stored encrypted, write-only, and never logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRig, stored } from './support/rig.js';
import { encryptSecret } from '../src/plugin/secret.js';
import { waitFor, settle } from './support/wait.js';

const PASSWORD = 's3cret-pw-9271';

const save = (rig, ctx, settings) => rig.studio.sendToPlugin(ctx, { type: 'saveConnection', settings });
const connSettings = (rig) => ({ host: '127.0.0.1', port: rig.obs.port });

test('saving from the inspector stores only ciphertext and connects with the password', async (t) => {
  const rig = await startRig({ obsPassword: PASSWORD, settings: () => ({ host: '127.0.0.1', port: 1, passwordEnc: '' }), connectObs: false });
  t.after(() => rig.stop());
  const stop = rig.studio.add('stop');

  save(rig, stop, { ...connSettings(rig), password: PASSWORD });
  await waitFor(() => rig.obs.identifies.length === 1, 'authenticated connection');

  const storedJson = JSON.stringify(rig.studio.globalSettings);
  assert.ok(!storedJson.includes(PASSWORD), 'plaintext password must not be stored');
  assert.ok(rig.studio.globalSettings.passwordEnc.startsWith('v1:'));

  rig.studio.run(stop);
  await waitFor(() => rig.obs.requests.length === 1, 'ptz_stop');
});

test('stored encrypted settings authenticate on startup', async (t) => {
  const rig = await startRig({ obsPassword: PASSWORD });
  t.after(() => rig.stop());
  assert.equal(rig.obs.identifies.length, 1);
});

test('saving with a blank password keeps the saved one', async (t) => {
  const rig = await startRig({ obsPassword: PASSWORD });
  t.after(() => rig.stop());
  const stop = rig.studio.add('stop');
  const before = rig.studio.globalSettings.passwordEnc;

  save(rig, stop, { ...connSettings(rig), password: '' });
  await waitFor(() => rig.studio.commands('setGlobalSettings').length === 1, 'save');
  rig.studio.run(stop);
  await waitFor(() => rig.obs.requests.length === 1, 'ptz_stop still authenticated');
  assert.ok(rig.studio.globalSettings.passwordEnc, 'still has a password');
  assert.notEqual(before, '');
});

test('clearPassword removes the saved password', async (t) => {
  const rig = await startRig({ obsPassword: PASSWORD });
  t.after(() => rig.stop());
  const stop = rig.studio.add('stop');

  save(rig, stop, { ...connSettings(rig), clearPassword: true });
  await waitFor(() => rig.studio.globalSettings.passwordEnc === '', 'cleared');
});

test('Test connection with a blank password uses the saved password', async (t) => {
  const rig = await startRig({ obsPassword: PASSWORD });
  t.after(() => rig.stop());
  const pi = rig.studio.add('stop');

  rig.studio.sendToPlugin(pi, { type: 'testConnection', settings: { ...connSettings(rig), password: '' } });
  await waitFor(() => rig.studio.commands('sendToPropertyInspector', pi).length === 1, 'result');
  assert.equal(rig.studio.commands('sendToPropertyInspector', pi)[0].payload.ok, true);
});

test('a legacy plaintext password is accepted and scrubbed from storage', async (t) => {
  const rig = await startRig({
    obsPassword: PASSWORD,
    settings: (base) => ({ host: base.host, port: base.port, password: PASSWORD }),
  });
  t.after(() => rig.stop());

  await waitFor(() => rig.studio.commands('setGlobalSettings').length === 1, 'scrub');
  assert.ok(!JSON.stringify(rig.studio.globalSettings).includes(PASSWORD));
  assert.equal(rig.obs.identifies.length, 1);
});

test('a password that cannot be decrypted is treated as unset (key alert, no crash)', async (t) => {
  const rig = await startRig({
    obsPassword: PASSWORD,
    settings: (base) => ({ host: base.host, port: base.port, passwordEnc: encryptSecret(PASSWORD, 'some-other-machine') }),
    connectObs: false,
  });
  t.after(() => rig.stop());
  const stop = rig.studio.add('stop');
  await settle();
  rig.studio.run(stop);
  await waitFor(() => rig.studio.commands('showAlert', stop).length === 1, 'alert');
  assert.equal(rig.obs.requests.length, 0);
});

test('the password never appears in anything sent to Studio, including debug logs', async (t) => {
  process.env.OBSPTZ_DEBUG = '1';
  t.after(() => delete process.env.OBSPTZ_DEBUG);
  const rig = await startRig({ obsPassword: PASSWORD });
  t.after(() => rig.stop());
  const stop = rig.studio.add('stop');

  rig.studio.sendToPlugin(stop, { type: 'testConnection', settings: { ...connSettings(rig), password: PASSWORD } });
  await waitFor(() => rig.studio.commands('sendToPropertyInspector', stop).length === 1, 'test result');
  save(rig, stop, { ...connSettings(rig), password: PASSWORD });
  await waitFor(() => rig.studio.commands('setGlobalSettings').length === 1, 'save');
  rig.studio.run(stop);
  await waitFor(() => rig.obs.requests.length === 1, 'request');
  await settle();

  assert.ok(rig.studio.commands('logMessage').length > 0, 'debug logging is on');
  assert.ok(!JSON.stringify(rig.studio.sent).includes(PASSWORD), 'password leaked to Studio');
});
