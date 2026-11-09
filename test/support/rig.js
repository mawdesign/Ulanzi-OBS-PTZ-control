// Wires the seam together: fake OBS + fake Studio + the real main service.
import { FakeObs } from './fake-obs.js';
import { FakeStudio } from './fake-studio.js';
import { startService } from '../../src/plugin/service.js';
import { waitFor } from './wait.js';
import { encryptSecret } from '../../src/plugin/secret.js';

/** Settings as the plugin stores them in Studio's global settings (password encrypted). */
export const stored = ({ host, port, password }) => ({
  host,
  port,
  passwordEnc: password ? encryptSecret(password) : '',
});

/**
 * @param {{ obsPassword?: string, settings?: object, requestTimeoutMs?: number, connectObs?: boolean, timers?: object, setupObs?: (obs: FakeObs) => void }} [opts]
 *   settings: global settings Studio hands the plugin, or a function of the plaintext default
 *   `{host, port, password}` (pointing at the fake OBS) returning them. Default: `stored(default)`.
 */
export async function startRig({ obsPassword = '', settings, requestTimeoutMs = 5000, connectObs = true, timers, setupObs } = {}) {
  const obs = new FakeObs({ password: obsPassword });
  setupObs?.(obs); // arrange cameras, features and presets before the plugin first reads them
  await obs.start();
  const studio = new FakeStudio();
  await studio.start();
  const base = { host: '127.0.0.1', port: obs.port, password: obsPassword };
  studio.globalSettings = typeof settings === 'function' ? settings(base) : (settings ?? stored(base));

  const service = startService({ port: studio.port, address: '127.0.0.1', requestTimeoutMs, ...(timers && { timers }) });
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
