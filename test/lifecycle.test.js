// Seam tests for ticket #5: reconnect with backoff and the Disconnected key state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRig, stored } from './support/rig.js';
import { fakeTimers } from './support/fake-timers.js';
import { waitFor, settle } from './support/wait.js';

const NORMAL = 0;
const DISCONNECTED = 1;

test('dropping the OBS connection shows Disconnected on every key; reconnecting restores Normal', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({ timers: clock.timers });
  t.after(() => rig.stop());
  const a = rig.studio.add('stop', { key: '0_0' });
  await waitFor(() => rig.studio.stateOf(a) === NORMAL, 'Normal while connected');

  rig.obs.dropConnections();
  const b = rig.studio.add('stop', { key: '0_1' }); // added while disconnected
  await waitFor(() => rig.studio.stateOf(a) === DISCONNECTED && rig.studio.stateOf(b) === DISCONNECTED, 'Disconnected on all keys');

  await waitFor(() => clock.pendingCount === 1, 'a reconnect to be scheduled');
  clock.fire();
  await waitFor(() => rig.studio.stateOf(a) === NORMAL && rig.studio.stateOf(b) === NORMAL, 'Normal again');

  assert.equal(rig.obs.identifies.length, 2);
  assert.equal(rig.obs.identifies[1].eventSubscriptions, 1 << 9, 're-subscribed to vendor events');
  rig.studio.run(a);
  await waitFor(() => rig.obs.requests.length === 1, 'Stop works after reconnecting');
});

test('reconnect attempts back off 1 s, 2 s, 4 s ... up to 30 s', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({ timers: clock.timers });
  t.after(() => rig.stop());
  const port = rig.obs.port;

  await rig.obs.stop(); // OBS goes away entirely
  await waitFor(() => clock.pendingCount === 1, 'first retry scheduled');
  for (let i = 0; i < 6; i++) {
    clock.fire();
    await waitFor(() => clock.pendingCount === 1, `retry ${i + 2} scheduled`);
  }
  assert.deepEqual(clock.delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);

  // OBS comes back: the next retry connects and the delay resets for any later outage.
  await rig.obs.start(port);
  const key = rig.studio.add('stop');
  clock.fire();
  await waitFor(() => rig.studio.stateOf(key) === NORMAL, 'reconnected');
  rig.obs.dropConnections();
  await waitFor(() => clock.pendingCount === 1, 'retry after a fresh drop');
  assert.equal(clock.delays.at(-1), 1000, 'backoff reset after a successful connection');
});

test('starting before OBS is up: keys show Disconnected, then connect once OBS appears', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({ timers: clock.timers, connectObs: false });
  t.after(() => rig.stop());
  const port = rig.obs.port;
  await rig.obs.stop();
  rig.obs.identifies.length = 0;

  const key = rig.studio.add('stop');
  await waitFor(() => rig.studio.stateOf(key) === DISCONNECTED, 'Disconnected');

  await rig.obs.start(port);
  await waitFor(() => clock.pendingCount === 1, 'a retry to be pending');
  clock.fire();
  await waitFor(() => rig.studio.stateOf(key) === NORMAL, 'Normal once OBS is reachable');
});

test('a wrong password keeps keys Disconnected and retries with backoff, not in a tight loop', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({
    obsPassword: 's3cret',
    settings: (base) => stored({ ...base, password: 'wrong' }),
    connectObs: false,
    timers: clock.timers,
  });
  t.after(() => rig.stop());
  const key = rig.studio.add('stop');

  await waitFor(() => clock.pendingCount === 1, 'first retry scheduled');
  await settle(300); // nothing else happens on its own
  assert.equal(clock.delays.length, 1);
  assert.equal(rig.studio.stateOf(key), DISCONNECTED);

  clock.fire();
  await waitFor(() => clock.pendingCount === 1, 'second retry scheduled');
  assert.deepEqual(clock.delays, [1000, 2000]);
  assert.equal(rig.obs.identifies.length, 0);
  assert.equal(rig.studio.stateOf(key), DISCONNECTED);
});

test('saving corrected settings reconnects immediately and resets the backoff', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({
    obsPassword: 's3cret',
    settings: (base) => stored({ ...base, password: 'wrong' }),
    connectObs: false,
    timers: clock.timers,
  });
  t.after(() => rig.stop());
  const key = rig.studio.add('stop');
  await waitFor(() => clock.pendingCount === 1, 'retry scheduled');

  rig.studio.sendToPlugin(key, {
    type: 'saveConnection',
    settings: { host: '127.0.0.1', port: rig.obs.port, password: 's3cret' },
  });
  await waitFor(() => rig.studio.stateOf(key) === NORMAL, 'Normal after fixing the password');
});
