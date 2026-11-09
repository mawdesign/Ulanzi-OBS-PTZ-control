// The plugin's main service: owns the single OBS connection and turns Ulanzi Studio events into
// OBS-PTZ requests. Everything outside this module's inputs/outputs (Studio messages in, OBS
// requests and Studio commands out) is an implementation detail.
import { UlanziApi } from '../vendor/ulanzi-api/index.js';
import { ObsClient, PtzError, DEFAULT_REQUEST_TIMEOUT_MS } from './obs-client.js';

export const MAIN_UUID = 'com.ulanzi.ulanzistudio.obsptz';
const ACTION_PREFIX = `${MAIN_UUID}.`;

export const DEFAULT_CONNECTION = Object.freeze({ host: 'localhost', port: 4455, password: '' });

/** Fill defaults and coerce types for connection settings coming from Studio or the inspector. */
export function normalizeConnection(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const port = Number(s.port);
  return {
    host: typeof s.host === 'string' && s.host.trim() ? s.host.trim() : DEFAULT_CONNECTION.host,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_CONNECTION.port,
    password: typeof s.password === 'string' ? s.password : DEFAULT_CONNECTION.password,
  };
}

const sameConnection = (a, b) => a && b && a.host === b.host && a.port === b.port && a.password === b.password;

/**
 * Start the main service.
 * @param {{ port?: number, address?: string, requestTimeoutMs?: number }} [opts]
 *   port/address default to the values Ulanzi Studio passes on the command line.
 */
export function startService({ port, address, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  const $UD = new UlanziApi();

  // --- logging: Studio's log channel. Debug is opt-in; secrets are never passed in. ---
  const debugOn = () => process.env.OBSPTZ_DEBUG === '1';
  const log = (level, msg) => {
    if (level === 'debug' && !debugOn()) return;
    $UD.logMessage(`[obsptz] ${msg}`, level);
  };

  // --- state ---
  /** @type {Map<string, { kind: string, params: Record<string, any> }>} */
  const instances = new Map(); // keyed by Studio context
  let connection = null; // normalized settings last received from Studio
  let obs = null; // ObsClient for `connection`
  let connecting = null; // in-flight connect promise

  const kindOf = (actionUuid) => (actionUuid?.startsWith(ACTION_PREFIX) ? actionUuid.slice(ACTION_PREFIX.length) : null);

  function setInstance(msg) {
    const kind = kindOf(msg.uuid);
    if (!kind) return;
    instances.set(msg.context, { kind, params: msg.param && typeof msg.param === 'object' ? msg.param : {} });
  }

  // --- OBS connection ---
  async function resetConnection(next) {
    const old = obs;
    obs = null;
    connecting = null;
    connection = next;
    if (old) await old.disconnect();
  }

  /** Connect with the current settings (shared by concurrent callers). */
  function ensureConnected() {
    if (obs?.connected) return Promise.resolve(obs);
    if (connecting) return connecting;
    const client = new ObsClient({ requestTimeoutMs });
    const conn = connection ?? normalizeConnection(null);
    const attempt = client
      .connect(conn)
      .then(() => {
        obs = client;
        log('info', `Connected to OBS at ${conn.host}:${conn.port}`);
        return client;
      })
      .catch((err) => {
        log('warn', `Could not connect to OBS at ${conn.host}:${conn.port}: ${err.message}`);
        throw err;
      })
      .finally(() => {
        if (connecting === attempt) connecting = null;
      });
    connecting = attempt;
    return attempt;
  }

  async function callPtz(context, requestType, data) {
    try {
      const client = await ensureConnected();
      return await client.call(requestType, data);
    } catch (err) {
      log('warn', `${requestType} failed: ${err instanceof PtzError ? err.code : 'error'}: ${err.message}`);
      $UD.showAlert(context);
      return null;
    }
  }

  // --- actions ---
  const targetDevice = (inst) => (typeof inst.params.device === 'string' && inst.params.device) || 'selected';

  function onRun(msg) {
    const inst = instances.get(msg.context);
    if (!inst) return;
    if (inst.kind === 'stop') callPtz(msg.context, 'ptz_stop', { device: targetDevice(inst) });
  }

  // --- inspector requests ---
  async function testConnection(context, rawSettings) {
    const conn = normalizeConnection(rawSettings);
    const client = new ObsClient({ requestTimeoutMs });
    let result;
    try {
      await client.connect(conn);
      result = { type: 'testConnectionResult', ok: true, message: `Connected to OBS at ${conn.host}:${conn.port}` };
    } catch (err) {
      result = { type: 'testConnectionResult', ok: false, message: err.message || 'Could not connect to OBS' };
    } finally {
      await client.disconnect();
    }
    $UD.sendToPropertyInspector(result, context);
  }

  function onSendToPlugin(msg) {
    const payload = msg.payload;
    if (payload?.type === 'testConnection') testConnection(msg.context, payload.settings);
  }

  // --- Studio events ---
  // Event bodies can carry secrets (global settings, test-connection payloads): log names only.
  const quiet = new Set(['didReceiveGlobalSettings', 'sendToPlugin']);
  const trace = (cmd, msg) => log('debug', `event ${cmd}${quiet.has(cmd) ? '' : ` ${JSON.stringify(msg)}`}`);

  $UD.connect(MAIN_UUID, port, address);

  $UD.onConnected(() => {
    log('info', 'Connected to Ulanzi Studio');
    $UD.getGlobalSettings();
  });
  $UD.onAdd((m) => (trace('add', m), setInstance(m)));
  $UD.onParamFromApp((m) => (trace('paramfromapp', m), setInstance(m)));
  $UD.onClear((m) => {
    trace('clear', m);
    for (const item of m.param ?? []) instances.delete(item.context);
  });
  $UD.onRun((m) => (trace('run', m), onRun(m)));
  $UD.onSendToPlugin((m) => (trace('sendToPlugin', m), onSendToPlugin(m)));
  $UD.onDidReceiveGlobalSettings(async (m) => {
    trace('didReceiveGlobalSettings', m);
    const next = normalizeConnection(m.settings);
    if (sameConnection(connection, next)) return;
    await resetConnection(next);
    ensureConnected().catch(() => {}); // failure is logged; later presses retry
  });
  // Trace-only events (debug): kept so real Studio behaviour can be recorded for the spike findings.
  $UD.onKeyDown((m) => trace('keydown', m));
  $UD.onKeyUp((m) => trace('keyup', m));
  $UD.onSetActive((m) => trace('setactive', m));
  $UD.onParamFromPlugin((m) => trace('paramfromplugin', m));
  $UD.onDialDown((m) => trace('dialdown', m));
  $UD.onDialUp((m) => trace('dialup', m));
  $UD.onDialRotate((m) => trace('dialrotate', m));
  $UD.onClose(() => log('warn', 'Disconnected from Ulanzi Studio'));
  $UD.onError((e) => log('error', String(e)));

  return {
    async stop() {
      await resetConnection(null);
      $UD.websocket?.close();
    },
  };
}
