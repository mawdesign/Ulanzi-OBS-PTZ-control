// Wires the seam together: fake OBS + fake Studio + the real main service.
import { FakeObs } from './fake-obs.js';
import { FakeStudio } from './fake-studio.js';
import { startService } from '../../src/plugin/service.js';
import { waitFor } from './wait.js';

/**
 * @param {{ obsPassword?: string, settings?: object, requestTimeoutMs?: number, connectObs?: boolean }} [opts]
 *   settings: global settings Studio hands the plugin, or a function of the default (fake OBS) settings.
 */
export async function startRig({ obsPassword = '', settings, requestTimeoutMs = 5000, connectObs = true } = {}) {
  const obs = new FakeObs({ password: obsPassword });
  await obs.start();
  const studio = new FakeStudio();
  await studio.start();
  const base = { host: '127.0.0.1', port: obs.port, password: obsPassword };
  studio.globalSettings = typeof settings === 'function' ? settings(base) : (settings ?? base);

  const service = startService({ port: studio.port, address: '127.0.0.1', requestTimeoutMs });
  await studio.ready();
  if (connectObs) await waitFor(() => obs.identifies.length > 0, 'plugin to connect to OBS');

  return {
    obs,
    studio,
    service,
    async stop() {
      await service.stop();
      await studio.stop();
      await obs.stop();
    },
  };
}
