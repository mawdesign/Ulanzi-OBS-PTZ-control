// A fake obs-websocket v5 server with the OBS-PTZ vendor bridge, for seam tests.
// Implements the real Hello/Identify handshake including password authentication, so the real
// obs-websocket-js client is exercised end to end.
import { WebSocketServer } from 'ws';
import { createHash, randomBytes } from 'node:crypto';

const sha256b64 = (s) => createHash('sha256').update(s).digest('base64');

// obs-websocket v5 op codes / close codes
/** What a fully capable camera reports. */
export const FULL_FEATURES = {
  pan: true, tilt: true, zoom: true, pan_abs: true, tilt_abs: true, zoom_abs: true, home: true, presets: true,
};

const OP = { Hello: 0, Identify: 1, Identified: 2, Request: 6, RequestResponse: 7 };
const CLOSE_AUTH_FAILED = 4009;

export class FakeObs {
  /** @param {{ password?: string }} [opts] empty password = authentication disabled */
  constructor({ password = '' } = {}) {
    this.password = password;
    /** vendor requests received, in order: { requestType, requestData } */
    this.requests = [];
    /** ptz_list_devices / ptz_get_selected calls, kept apart from control requests */
    this.discoveryRequests = [];
    /** identify payloads received (eventSubscriptions etc.) */
    this.identifies = [];
    this.handlers = new Map();
    this.sockets = new Set();
    this.devices = [
      { device: 'cam-uuid-1', name: 'Camera 1', source: 'Cam1', api: { major: 0, minor: 10 } },
      { device: 'cam-uuid-2', name: 'Camera 2', source: 'Cam2', api: { major: 0, minor: 10 } },
    ];
    /** device uuid -> features the camera reports (true = has it) */
    this.features = new Map(this.devices.map((d) => [d.device, { ...FULL_FEATURES }]));
    /** device uuid -> ordered presets [{ id, name }] */
    this.presets = new Map(this.devices.map((d) => [d.device, []]));
    this.selected = 'cam-uuid-1'; // null => no_selection
    this.silent = new Set(); // request types that never get an answer (timeout tests)
    this.#installDefaults();
  }

  #installDefaults() {
    this.handlers.set('ptz_stop', () => ({}));
    this.handlers.set('ptz_move', () => ({}));
    this.handlers.set('ptz_home_recall', () => ({}));
    this.handlers.set('ptz_preset_recall', () => ({}));
    this.handlers.set('ptz_list_devices', () => ({ devices: this.devices }));
    this.handlers.set('ptz_get_selected', () => ({ device: this.selected ?? '' }));
    this.handlers.set('ptz_get_state', (req) => ({ state: { features: this.features.get(this.#uuid(req.device)) } }));
    this.handlers.set('ptz_preset_get_list', (req) => this.#presetList(this.#uuid(req.device)));
  }

  #uuid(device) {
    return device === 'selected' ? this.selected : device;
  }

  #presetList(uuid) {
    const list = this.presets.get(uuid) ?? [];
    return {
      presets: Object.fromEntries(list.map((p) => [p.id, { name: p.name }])),
      order: list.map((p) => ({ id: p.id })),
    };
  }

  // --- presets and capabilities changed "in OBS" ---
  addPreset(uuid, preset) {
    this.presets.get(uuid).push(preset);
    this.#emitVendor('ptz_preset_added', { device: uuid, id: preset.id });
  }

  removePreset(uuid, id) {
    this.presets.set(uuid, this.presets.get(uuid).filter((p) => p.id !== id));
    this.#emitVendor('ptz_preset_removed', { device: uuid, id });
  }

  renamePreset(uuid, id, name) {
    this.presets.get(uuid).find((p) => p.id === id).name = name;
    this.#emitVendor('ptz_preset_changed', { device: uuid, id, changed: { name } });
  }

  reorderPresets(uuid, ids) {
    const byId = new Map(this.presets.get(uuid).map((p) => [p.id, p]));
    this.presets.set(uuid, ids.map((id) => byId.get(id)));
    this.#emitVendor('ptz_preset_order_changed', { device: uuid });
  }

  /** The camera now reports different features. */
  setFeatures(uuid, features) {
    this.features.set(uuid, features);
    this.#emitVendor('ptz_state_changed', { device: uuid, changed: { features } });
  }

  // --- changes made "in OBS", announced to subscribed clients as obs-ptz vendor events ---
  addDevice(dev) {
    this.devices.push(dev);
    this.features.set(dev.device, { ...FULL_FEATURES });
    this.presets.set(dev.device, []);
    this.#emitVendor('ptz_device_add', { device: dev.device });
  }

  removeDevice(uuid) {
    this.devices = this.devices.filter((d) => d.device !== uuid);
    if (this.selected === uuid) this.selected = null;
    this.#emitVendor('ptz_device_remove', { device: uuid });
  }

  select(uuid) {
    this.selected = uuid;
    this.#emitVendor('ptz_selected_changed', { device: uuid ?? '' });
  }

  #emitVendor(eventType, eventData) {
    const OP_EVENT = 5;
    const VENDORS = 1 << 9;
    for (const ws of this.sockets) {
      if (!(ws.eventSubscriptions & VENDORS)) continue; // only clients that asked for vendor events
      ws.send(
        JSON.stringify({
          op: OP_EVENT,
          d: {
            eventType: 'VendorEvent',
            eventIntent: VENDORS,
            eventData: { vendorName: 'obs-ptz', eventType, eventData },
          },
        }),
      );
    }
  }

  /** Register a handler `(requestData) => responseData` for a vendor request type. */
  on(requestType, fn) {
    this.handlers.set(requestType, fn);
  }

  /** Start listening. Pass the previous `port` to bring a stopped OBS back on the same address. */
  async start(port = 0) {
    this.wss = new WebSocketServer({
      port,
      handleProtocols: (protocols) => (protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false),
    });
    await new Promise((resolve) => this.wss.once('listening', resolve));
    this.port = this.wss.address().port;
    this.wss.on('connection', (ws) => this.#onConnection(ws));
  }

  async stop() {
    if (!this.wss) return;
    for (const ws of this.sockets) ws.terminate();
    const wss = this.wss;
    this.wss = null;
    await new Promise((resolve) => wss.close(resolve));
  }

  /** Drop every client connection (as if OBS crashed or the network blipped). */
  dropConnections() {
    for (const ws of this.sockets) ws.terminate();
  }

  #onConnection(ws) {
    this.sockets.add(ws);
    ws.on('close', () => this.sockets.delete(ws));

    const hello = { obsWebSocketVersion: '5.5.0', rpcVersion: 1 };
    let challenge;
    if (this.password) {
      const salt = randomBytes(16).toString('base64');
      challenge = randomBytes(16).toString('base64');
      hello.authentication = { challenge, salt };
      this.salt = salt;
    }
    ws.send(JSON.stringify({ op: OP.Hello, d: hello }));

    let identified = false;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.op === OP.Identify) {
        if (this.password) {
          const secret = sha256b64(this.password + this.salt);
          const expected = sha256b64(secret + challenge);
          if (msg.d.authentication !== expected) return ws.close(CLOSE_AUTH_FAILED, 'Authentication failed.');
        }
        this.identifies.push(msg.d);
        ws.eventSubscriptions = msg.d.eventSubscriptions ?? 0;
        identified = true;
        ws.send(JSON.stringify({ op: OP.Identified, d: { negotiatedRpcVersion: 1 } }));
      } else if (msg.op === OP.Request && identified) {
        this.#onRequest(ws, msg.d);
      }
    });
  }

  #respond(ws, d, ok, code, responseData, comment) {
    ws.send(
      JSON.stringify({
        op: OP.RequestResponse,
        d: {
          requestType: d.requestType,
          requestId: d.requestId,
          requestStatus: { result: ok, code, ...(comment ? { comment } : {}) },
          ...(responseData !== undefined ? { responseData } : {}),
        },
      }),
    );
  }

  #onRequest(ws, d) {
    if (d.requestType !== 'CallVendorRequest') return this.#respond(ws, d, false, 204, undefined, 'Unknown request');
    const { vendorName, requestType, requestData = {} } = d.requestData;
    if (vendorName !== 'obs-ptz') return this.#respond(ws, d, false, 600, undefined, 'No such vendor');
    // Camera-discovery calls (list/selected) are bookkeeping; `requests` is the log of control requests.
    const isBinding = ['ptz_list_devices', 'ptz_get_selected', 'ptz_get_state', 'ptz_preset_get_list'].includes(requestType);
    (isBinding ? this.discoveryRequests : this.requests).push({ requestType, requestData });
    if (this.silent.has(requestType)) return;

    const wrap = (inner) => this.#respond(ws, d, true, 100, { vendorName, requestType, responseData: inner });

    // OBS-PTZ failures are reported in the response data, not as an obs-websocket failure.
    if (requestData.device === 'selected' && this.selected == null) {
      return wrap({ error: 'no_selection', message: 'No camera is selected in the PTZ dock' });
    }
    if (!isBinding && requestData.device !== 'selected' && !this.devices.some((d) => d.device === requestData.device)) {
      return wrap({ error: 'unknown_device', message: `No PTZ device ${requestData.device}` });
    }
    const handler = this.handlers.get(requestType);
    if (!handler) return wrap({ error: 'no_such_proc', message: `No proc ${requestType}` });
    const answer = handler(requestData) ?? {};
    wrap(requestData.device === 'selected' && !answer.error ? { device: this.selected, ...answer } : answer);
  }
}
