// The plugin's main service: owns the single OBS connection and turns Ulanzi Studio events into
// OBS-PTZ requests. Everything outside this module's inputs/outputs (Studio messages in, OBS
// requests and Studio commands out) is an implementation detail.
import { UlanziApi } from '../vendor/ulanzi-api/index.js';
import { ObsClient, PtzError, DEFAULT_REQUEST_TIMEOUT_MS } from './obs-client.js';
import { encryptSecret, decryptSecret, defaultKeyMaterial } from './secret.js';

export const MAIN_UUID = 'com.ulanzi.ulanzistudio.obsptz';
const ACTION_PREFIX = `${MAIN_UUID}.`;

export const MIN_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30000;
const STATE_NORMAL = 0;
const STATE_DISCONNECTED = 1;

/** OBS-PTZ Device API this plugin was written for: major 0, minor 10 or any newer 0.x. */
export const API_MAJOR = 0;
export const API_MIN_MINOR = 10;
export const isSupportedApi = (api) => Boolean(api) && api.major === API_MAJOR && api.minor >= API_MIN_MINOR;

/** What a camera must report in `features` for each kind of key (Stop needs nothing). */
const PRESET_SIGNALS = new Set(['ptz_preset_added', 'ptz_preset_removed', 'ptz_preset_changed', 'ptz_preset_order_changed', 'ptz_preset_list_reset']);
const REQUIRED_FEATURE = { home: 'home', preset: 'presets' };
const FEATURE_LABEL = { home: 'a home position', presets: 'presets' };

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

/** Shape stored in Studio's global settings: the password only ever appears encrypted. */
const toStored = (conn, keyMaterial) => ({
  host: conn.host,
  port: conn.port,
  passwordEnc: conn.password ? encryptSecret(conn.password, keyMaterial) : '',
});

const sameConnection = (a, b) => a && b && a.host === b.host && a.port === b.port && a.password === b.password;

/**
 * Start the main service.
 * @param {{ port?: number, address?: string, requestTimeoutMs?: number, keyMaterial?: string }} [opts]
 *   port/address default to the values Ulanzi Studio passes on the command line.
 *   keyMaterial overrides the machine-derived key used to protect the stored password (tests).
 *   timers overrides setTimeout/clearTimeout for reconnect scheduling (tests use a controllable clock).
 */
export function startService({
  port,
  address,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  keyMaterial = defaultKeyMaterial(),
  timers = { setTimeout, clearTimeout },
} = {}) {
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
  let retryTimer = null; // pending reconnect
  let backoffMs = MIN_BACKOFF_MS;
  let stopped = false;
  /** @type {Map<string, { device: string, name: string }>} cameras OBS-PTZ knows about */
  let devices = new Map();
  let selectedDevice = ''; // uuid of the camera selected in the PTZ dock, or ''
  /** @type {Map<string, Record<string, boolean>>} features each supported camera reports */
  let features = new Map();
  /** @type {Map<string, { id: string, name: string }[]>} presets, in display order, per camera */
  let presets = new Map();
  let cameraData = Promise.resolve(); // settles once the camera list, features and presets are read
  const inspectors = new Set(); // contexts of inspectors that asked for the camera list

  const kindOf = (actionUuid) => (actionUuid?.startsWith(ACTION_PREFIX) ? actionUuid.slice(ACTION_PREFIX.length) : null);

  function setInstance(msg) {
    const kind = kindOf(msg.uuid);
    if (!kind) return;
    instances.set(msg.context, { kind, params: msg.param && typeof msg.param === 'object' ? msg.param : {} });
    showState(msg.context);
    if (inspectors.has(msg.context)) pushDevices(msg.context); // the camera choice may have changed
  }

  // --- key state: Normal while connected to OBS, Disconnected otherwise ---
  const isConnected = () => Boolean(obs?.connected);
  const showState = (context) => $UD.setStateIcon(context, isConnected() ? STATE_NORMAL : STATE_DISCONNECTED);
  const showAllStates = () => instances.forEach((_, context) => showState(context));

  // --- cameras ---
  const targetUuid = (inst) => {
    const pinned = typeof inst.params.device === 'string' && inst.params.device;
    return !pinned || pinned === 'selected' ? selectedDevice : pinned;
  };

  /**
   * Can this key act on its camera? Checked before any request is sent, so an unsupported camera or
   * a feature it lacks never reaches OBS. A camera OBS does not list is let through for OBS to answer.
   * @returns {{ ok: boolean, message: string }}
   */
  function checkTarget(inst) {
    const uuid = targetUuid(inst);
    const dev = devices.get(uuid);
    if (!dev) return { ok: true, message: '' };
    if (!isSupportedApi(dev.api)) {
      const v = dev.api ? `${dev.api.major}.${dev.api.minor}` : 'unknown';
      return { ok: false, message: `${dev.name} implements OBS-PTZ API ${v}. This plugin needs ${API_MAJOR}.${API_MIN_MINOR} or a newer ${API_MAJOR}.x.` };
    }
    const need = REQUIRED_FEATURE[inst.kind];
    if (need && !features.get(uuid)?.[need]) return { ok: false, message: `${dev.name} does not support ${FEATURE_LABEL[need]}.` };
    return { ok: true, message: '' };
  }

  const devicesPayload = (inst) => ({
    type: 'devices',
    connected: isConnected(),
    selected: selectedDevice,
    devices: [...devices.values()].map(({ device, name, api }) => ({ device, name, supported: isSupportedApi(api) })),
    // How the inspector's own action fares with the camera it is set to: a message, and its preset list.
    ...(inst && { target: { ...checkTarget(inst), presets: presets.get(targetUuid(inst)) ?? [] } }),
  });

  function pushDevices(context) {
    for (const c of context ? [context] : inspectors) $UD.sendToPropertyInspector(devicesPayload(instances.get(c)), c);
  }

  async function refreshFeatures(client, uuid) {
    try {
      const answer = await client.call('ptz_get_state', { device: uuid });
      features.set(uuid, (answer.state ?? answer).features ?? {});
    } catch (err) {
      log('warn', `Could not read the features of camera ${uuid}: ${err.message}`);
    }
  }

  async function refreshPresets(client, uuid) {
    try {
      const answer = await client.call('ptz_preset_get_list', { device: uuid });
      const body = answer.return ?? answer;
      presets.set(uuid, (body.order ?? []).map(({ id }) => ({ id, name: body.presets?.[id]?.name || id })));
    } catch (err) {
      log('warn', `Could not read the presets of camera ${uuid}: ${err.message}`);
    }
  }

  /** Features, then presets if the camera has them. Cameras on an unsupported API are not called at all. */
  async function refreshCamera(client, uuid) {
    if (!isSupportedApi(devices.get(uuid)?.api)) return;
    await refreshFeatures(client, uuid);
    if (features.get(uuid)?.presets) await refreshPresets(client, uuid);
    else presets.delete(uuid);
  }

  /** Read the camera list and selection. Signals are subscribed first, as the OBS-PTZ API advises. */
  async function refreshDevices(client) {
    try {
      const list = await client.call('ptz_list_devices');
      const sel = await client.call('ptz_get_selected');
      devices = new Map((list.devices ?? []).map((d) => [d.device, d]));
      selectedDevice = typeof sel.device === 'string' ? sel.device : '';
      features = new Map();
      presets = new Map();
      await Promise.all([...devices.keys()].map((uuid) => refreshCamera(client, uuid)));
    } catch (err) {
      log('warn', `Could not read the camera list: ${err.message}`);
    }
    pushDevices();
  }

  function onPtzEvent(client, type, data) {
    if (type === 'ptz_device_add') return void refreshDevices(client);
    if (type === 'ptz_device_remove') {
      devices.delete(data.device);
      features.delete(data.device);
      presets.delete(data.device);
    } else if (type === 'ptz_state_changed') {
      if (!data.changed?.features) return;
      return void refreshCamera(client, data.device).then(() => pushDevices());
    } else if (PRESET_SIGNALS.has(type)) {
      if (!features.get(data.device)?.presets) return;
      return void refreshPresets(client, data.device).then(() => pushDevices());
    } else if (type === 'ptz_selected_changed') selectedDevice = typeof data.device === 'string' ? data.device : '';
    else return;
    pushDevices();
  }

  // --- OBS connection ---
  function cancelRetry() {
    if (retryTimer) timers.clearTimeout(retryTimer);
    retryTimer = null;
    backoffMs = MIN_BACKOFF_MS;
  }

  async function resetConnection(next) {
    const old = obs;
    obs = null;
    connecting = null;
    connection = next;
    cancelRetry();
    showAllStates();
    if (old) await old.disconnect();
  }

  /** Retry later, doubling the delay from 1 s up to 30 s. One retry is pending at a time. */
  function scheduleReconnect() {
    if (stopped || retryTimer || !connection) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    log('info', `Will retry connecting to OBS in ${delay / 1000} s`);
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      ensureConnected().catch(() => {});
    }, delay);
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
        if (connecting !== attempt) {
          // settings changed or the service stopped while connecting: drop this connection
          client.disconnect();
          throw new Error('Connection settings changed while connecting');
        }
        obs = client;
        backoffMs = MIN_BACKOFF_MS;
        client.on('ptzEvent', (type, data) => onPtzEvent(client, type, data));
        client.on('disconnected', () => {
          if (obs !== client) return;
          obs = null;
          log('warn', 'Lost the connection to OBS');
          devices = new Map();
          features = new Map();
          presets = new Map();
          selectedDevice = '';
          showAllStates();
          pushDevices();
          scheduleReconnect();
        });
        log('info', `Connected to OBS at ${conn.host}:${conn.port}`);
        showAllStates();
        cameraData = refreshDevices(client); // presses wait for this (see callPtz), the connection does not
        return client;
      })
      .catch((err) => {
        log('warn', `Could not connect to OBS at ${conn.host}:${conn.port}: ${err.message}`);
        if (connecting === attempt) scheduleReconnect();
        throw err;
      })
      .finally(() => {
        if (connecting === attempt) connecting = null;
      });
    connecting = attempt;
    return attempt;
  }

  /** @param inst when given, the key's camera must support its action (checked once connected) */
  async function callPtz(context, requestType, data, inst) {
    try {
      const client = await ensureConnected();
      await cameraData; // so a press right after connecting is checked against real data
      const check = inst ? checkTarget(inst) : { ok: true };
      if (!check.ok) {
        log('warn', `${requestType} not sent: ${check.message}`);
        $UD.showAlert(context);
        return null;
      }
      return await client.call(requestType, data);
    } catch (err) {
      log('warn', `${requestType} failed: ${err instanceof PtzError ? err.code : 'error'}: ${err.message}`);
      $UD.showAlert(context);
      return null;
    }
  }

  // --- actions ---
  const targetDevice = (inst) => (typeof inst.params.device === 'string' && inst.params.device) || 'selected';

  /** Send a control request, unless the camera cannot do it. Unsupported requests never leave the plugin. */
  const control = (context, inst, requestType, extra = {}) =>
    callPtz(context, requestType, { device: targetDevice(inst), ...extra }, inst);

  function onRun(msg) {
    const inst = instances.get(msg.context);
    if (!inst) return;
    if (inst.kind === 'stop') control(msg.context, inst, 'ptz_stop');
    else if (inst.kind === 'home') control(msg.context, inst, 'ptz_home_recall');
    else if (inst.kind === 'preset') recallPreset(msg.context, inst);
  }

  function recallPreset(context, inst) {
    const id = inst.params.preset;
    const known = presets.get(targetUuid(inst));
    if (!id || (known && !known.some((p) => p.id === id))) {
      // Recalling a preset that OBS no longer has would silently do nothing, so say so on the key.
      log('warn', `Preset ${id || '(none chosen)'} is not available on the camera`);
      return void $UD.showAlert(context);
    }
    control(context, inst, 'ptz_preset_recall', { id });
  }

  // --- connection settings ---
  /** Turn global settings from Studio into a usable connection. `legacy` = plaintext password found. */
  function resolveConnection(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    let password = '';
    let legacy = false;
    if (typeof s.passwordEnc === 'string' && s.passwordEnc) {
      try {
        password = decryptSecret(s.passwordEnc, keyMaterial);
      } catch {
        log('warn', 'The stored OBS password could not be decrypted (different machine or user?). Please re-enter it.');
      }
    } else if (typeof s.password === 'string' && s.password) {
      password = s.password;
      legacy = true;
    }
    return { conn: normalizeConnection({ ...s, password }), legacy };
  }

  async function applyConnection(next) {
    if (sameConnection(connection, next)) return;
    await resetConnection(next);
    ensureConnected().catch(() => {}); // failure is logged; later presses retry
  }

  /** The inspector saves here (not straight to Studio) so the password is encrypted before storage. */
  async function saveConnection(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const typed = typeof s.password === 'string' ? s.password : '';
    const password = s.clearPassword ? '' : typed || connection?.password || '';
    const next = normalizeConnection({ host: s.host, port: s.port, password });
    $UD.setGlobalSettings(toStored(next, keyMaterial));
    await applyConnection(next);
  }

  // --- inspector requests ---
  async function testConnection(context, rawSettings) {
    const typed = typeof rawSettings?.password === 'string' ? rawSettings.password : '';
    // A blank password field means "the saved one".
    const conn = normalizeConnection({ ...rawSettings, password: typed || connection?.password || '' });
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
    if (payload?.type === 'getDevices') {
      inspectors.add(msg.context);
      pushDevices(msg.context);
    } else if (payload?.type === 'testConnection') testConnection(msg.context, payload.settings);
    else if (payload?.type === 'saveConnection') saveConnection(payload.settings);
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
    for (const item of m.param ?? []) {
      instances.delete(item.context);
      inspectors.delete(item.context);
    }
  });
  $UD.onRun((m) => (trace('run', m), onRun(m)));
  $UD.onSendToPlugin((m) => (trace('sendToPlugin', m), onSendToPlugin(m)));
  $UD.onDidReceiveGlobalSettings(async (m) => {
    trace('didReceiveGlobalSettings', m);
    const { conn, legacy } = resolveConnection(m.settings);
    if (legacy) $UD.setGlobalSettings(toStored(conn, keyMaterial)); // scrub plaintext from storage
    await applyConnection(conn);
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
      stopped = true;
      await resetConnection(null);
      $UD.websocket?.close();
    },
  };
}
