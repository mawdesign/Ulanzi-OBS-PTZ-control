// Seam tests for tickets #10 (Move), #11 (motion safety) and #12 (Zoom).
// Sign convention under test is the provisional one in src/plugin/motion.js: +pan right, +tilt up, +zoom in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRig } from './support/rig.js';
import { fakeTimers } from './support/fake-timers.js';
import { waitFor, settle } from './support/wait.js';
import { FULL_FEATURES } from './support/fake-obs.js';

const moves = (rig) => rig.obs.requests.filter((r) => r.requestType === 'ptz_move').map((r) => r.requestData);
const CAM = 'cam-uuid-1';

const DIRECTIONS = {
  n: { pan: undefined, tilt: 0.5 },
  ne: { pan: 0.5, tilt: 0.5 },
  e: { pan: 0.5, tilt: undefined },
  se: { pan: 0.5, tilt: -0.5 },
  s: { pan: undefined, tilt: -0.5 },
  sw: { pan: -0.5, tilt: -0.5 },
  w: { pan: -0.5, tilt: undefined },
  nw: { pan: -0.5, tilt: 0.5 },
};

for (const [direction, speeds] of Object.entries(DIRECTIONS)) {
  test(`Move ${direction}: key down moves at the right signs, key up zeroes the same axes`, async (t) => {
    const rig = await startRig();
    t.after(() => rig.stop());
    const key = rig.studio.add('move', { param: { direction, speed: 0.5 } });

    rig.studio.keyDown(key);
    await waitFor(() => moves(rig).length === 1, 'move request');
    const down = { device: CAM };
    for (const axis of ['pan', 'tilt']) if (speeds[axis] !== undefined) down[axis] = speeds[axis];
    assert.deepEqual(moves(rig)[0], down);

    rig.studio.keyUp(key);
    await waitFor(() => moves(rig).length === 2, 'stop request');
    const up = { device: CAM };
    for (const axis of ['pan', 'tilt']) if (speeds[axis] !== undefined) up[axis] = 0;
    assert.deepEqual(moves(rig)[1], up);
    assert.equal(rig.studio.commands('showAlert').length, 0);
  });
}

test('a new Move key with no settings moves north at speed 0.5', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('move');
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move request');
  assert.deepEqual(moves(rig)[0], { device: CAM, tilt: 0.5 });
});

test('speed is taken from the key and kept within 0.1 to 1.0', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const slow = rig.studio.add('move', { key: '0_0', param: { direction: 'e', speed: 0.01 } });
  const fast = rig.studio.add('move', { key: '0_1', param: { direction: 'e', speed: 7 } });
  const custom = rig.studio.add('move', { key: '0_2', param: { direction: 'e', speed: '0.3' } });
  let expected = 0;
  for (const k of [slow, fast, custom]) {
    rig.studio.keyDown(k);
    expected += 1;
    await waitFor(() => moves(rig).length === expected, 'move');
    rig.studio.keyUp(k);
    expected += 1;
    await waitFor(() => moves(rig).length === expected, 'stop');
  }
  assert.deepEqual(moves(rig).filter((m) => m.pan !== 0).map((m) => m.pan).sort(), [0.1, 0.3, 1]);
});

test('Zoom key: in and out use the right sign and stop on release', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const zin = rig.studio.add('zoom', { key: '0_0', param: { direction: 'in', speed: 0.4 } });
  const zout = rig.studio.add('zoom', { key: '0_1', param: { direction: 'out', speed: 0.4 } });

  let expected = 0;
  for (const k of [zin, zout]) {
    rig.studio.keyDown(k);
    expected += 1;
    await waitFor(() => moves(rig).length === expected, 'move');
    rig.studio.keyUp(k);
    expected += 1;
    await waitFor(() => moves(rig).length === expected, 'stop');
  }
  assert.deepEqual(moves(rig), [
    { device: CAM, zoom: 0.4 },
    { device: CAM, zoom: 0 },
    { device: CAM, zoom: -0.4 },
    { device: CAM, zoom: 0 },
  ]);
});

test('Move and Zoom keys show an arrow for their direction', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const move = rig.studio.add('move', { key: '0_0', param: { direction: 'sw' } });
  const zoom = rig.studio.add('zoom', { key: '0_1', param: { direction: 'out' } });
  await waitFor(() => rig.studio.pathIconOf(move) && rig.studio.pathIconOf(zoom), 'icons');
  assert.equal(rig.studio.pathIconOf(move), './resources/move-sw.svg');
  assert.equal(rig.studio.pathIconOf(zoom), './resources/zoom-out.svg');
});

test('key auto-repeat does not send the move twice', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('move');
  rig.studio.keyDown(key);
  rig.studio.keyDown(key);
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  await settle();
  assert.equal(moves(rig).length, 1);
});

test('two Move keys held together stop independently', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const east = rig.studio.add('move', { key: '0_0', param: { direction: 'e' } });
  const north = rig.studio.add('move', { key: '0_1', param: { direction: 'n' } });

  rig.studio.keyDown(east);
  rig.studio.keyDown(north);
  await waitFor(() => moves(rig).length === 2, 'both moves');
  rig.studio.keyUp(east);
  await waitFor(() => moves(rig).length === 3, 'east stop');
  assert.deepEqual(moves(rig)[2], { device: CAM, pan: 0 }, 'only the pan axis is stopped; north keeps going');
  await settle();
  assert.equal(moves(rig).length, 3);
});

test('a key released before its move was sent never moves the camera', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  rig.studio.keyUp(key);
  await settle();
  await settle();
  const sent = moves(rig);
  // Either nothing went out, or the move is always followed by its stop.
  if (sent.length) assert.deepEqual(sent.map((m) => m.pan), [0.5, 0]);
});

test('the stop goes to the camera that was moved, even if the selection changes mid-hold', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  rig.obs.select('cam-uuid-2');
  await settle();
  rig.studio.keyUp(key);
  await waitFor(() => moves(rig).length === 2, 'stop');
  assert.equal(moves(rig)[0].device, 'cam-uuid-1');
  assert.equal(moves(rig)[1].device, 'cam-uuid-1');
});

test('a pinned key moves its own camera', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('move', { param: { direction: 'e', device: 'cam-uuid-2' } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  assert.equal(moves(rig)[0].device, 'cam-uuid-2');
});

test('a camera that cannot pan gets no move and the key alerts', async (t) => {
  const rig = await startRig({ setupObs: (obs) => obs.features.set('cam-uuid-1', { ...FULL_FEATURES, pan: false }) });
  t.after(() => rig.stop());
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  await waitFor(() => rig.studio.commands('showAlert', key).length === 1, 'alert');
  assert.equal(moves(rig).length, 0);
});

test('a failed move raises an alert', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  rig.obs.on('ptz_move', (req) => (req.pan ? { error: 'forbidden', message: 'read only' } : {}));
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  await waitFor(() => rig.studio.commands('showAlert', key).length === 1, 'alert');
});

// ---- #11: motion safety ----

test('set-active false for a held key stops it', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  rig.studio.setActive(key, false);
  await waitFor(() => moves(rig).length === 2, 'stop');
  assert.deepEqual(moves(rig)[1], { device: CAM, pan: 0 });
});

test('set-active true and false on a key that is not held send nothing', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('move');
  rig.studio.setActive(key, false);
  rig.studio.setActive(key, true);
  await settle();
  assert.equal(moves(rig).length, 0);
});

test('removing a held key stops it', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('zoom', { param: { direction: 'in' } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  rig.studio.clear(key);
  await waitFor(() => moves(rig).length === 2, 'stop');
  assert.deepEqual(moves(rig)[1], { device: CAM, zoom: 0 });
});

test('losing OBS while a key is held: no move restarts, and the stop is delivered when OBS returns', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({ timers: clock.timers });
  t.after(() => rig.stop());
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');

  rig.obs.dropConnections();
  await waitFor(() => rig.studio.stateOf(key) === 1, 'Disconnected');
  await waitFor(() => clock.pendingDelays.includes(1000), 'reconnect scheduled');
  clock.fireDelay(1000);
  await waitFor(() => moves(rig).length === 2, 'owed stop after reconnecting');
  assert.deepEqual(moves(rig)[1], { device: CAM, pan: 0 });
  await settle();
  assert.equal(moves(rig).length, 2, 'the move was not re-sent');
  assert.equal(clock.pendingDelays.includes(10000), false, 'watchdog cleared');
});

test('shutting the plugin down stops every moving key', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const a = rig.studio.add('move', { key: '0_0', param: { direction: 'e' } });
  const b = rig.studio.add('zoom', { key: '0_1', param: { direction: 'in' } });
  rig.studio.keyDown(a);
  rig.studio.keyDown(b);
  await waitFor(() => moves(rig).length === 2, 'both moving');

  await rig.service.stop();
  assert.deepEqual(moves(rig).slice(2).sort((x, y) => (x.pan === 0 ? -1 : 1)), [
    { device: CAM, pan: 0 },
    { device: CAM, zoom: 0 },
  ]);
});

test('Studio going away stops every moving key', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  rig.studio.main.terminate();
  await waitFor(() => moves(rig).length === 2, 'stop');
});

test('watchdog: with no key up, a stop is sent after the default 10 s', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({ timers: clock.timers });
  t.after(() => rig.stop());
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  assert.deepEqual(clock.pendingDelays, [10000]);

  clock.fireDelay(10000);
  await waitFor(() => moves(rig).length === 2, 'watchdog stop');
  assert.deepEqual(moves(rig)[1], { device: CAM, pan: 0 });
  rig.studio.keyUp(key); // a late key up must not stop twice
  await settle();
  assert.equal(moves(rig).length, 2);
});

test('watchdog time is configurable per key and a key up cancels it', async (t) => {
  const clock = fakeTimers();
  const rig = await startRig({ timers: clock.timers });
  t.after(() => rig.stop());
  const key = rig.studio.add('zoom', { param: { direction: 'in', watchdog: 25 } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  assert.deepEqual(clock.pendingDelays, [25000]);
  rig.studio.keyUp(key);
  await waitFor(() => moves(rig).length === 2, 'stop');
  assert.equal(clock.pendingCount, 0, 'watchdog cancelled by key up');
});

test('a stop that OBS rejects falls back to ptz_stop', async (t) => {
  const rig = await startRig();
  t.after(() => rig.stop());
  rig.obs.on('ptz_move', (req) => (req.pan === 0 ? { error: 'timeout', message: 'busy' } : {}));
  const key = rig.studio.add('move', { param: { direction: 'e' } });
  rig.studio.keyDown(key);
  await waitFor(() => moves(rig).length === 1, 'move');
  rig.studio.keyUp(key);
  await waitFor(() => rig.obs.requests.some((r) => r.requestType === 'ptz_stop'), 'fallback ptz_stop');
});
