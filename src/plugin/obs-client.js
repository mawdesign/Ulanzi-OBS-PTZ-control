// Thin client for OBS-PTZ's obs-websocket vendor API (vendorName "obs-ptz").
// Responsibilities: connect/authenticate, send vendor requests with a timeout, and turn the
// error-in-response-body convention into thrown PtzErrors.
import { OBSWebSocket, EventSubscription } from 'obs-websocket-js/json';
import { EventEmitter } from 'node:events';

export const VENDOR_NAME = 'obs-ptz';
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/** An OBS-PTZ failure. `code` is an OBS-PTZ error code (e.g. no_selection) or one of our own. */
export class PtzError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'PtzError';
    this.code = code;
  }
}

export class ObsClient extends EventEmitter {
  /** @param {{ requestTimeoutMs?: number }} [opts] */
  constructor({ requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
    super();
    this.requestTimeoutMs = requestTimeoutMs;
    this.connected = false;
    this.obs = new OBSWebSocket();
    this.obs.on('ConnectionClosed', () => {
      const was = this.connected;
      this.connected = false;
      if (was) this.emit('disconnected');
    });
    this.obs.on('ConnectionError', () => {});
    // obs-ptz signals arrive as VendorEvents: forward them as ('ptzEvent', signalName, data).
    this.obs.on('VendorEvent', (e) => {
      if (e?.vendorName === VENDOR_NAME) this.emit('ptzEvent', e.eventType, e.eventData ?? {});
    });
  }

  /** @param {{ host: string, port: number, password?: string }} conn */
  async connect({ host, port, password }) {
    // Only vendor events are needed (device add/remove, selection and state changes).
    await this.obs.connect(`ws://${host}:${port}`, password || undefined, {
      eventSubscriptions: EventSubscription.Vendors,
    });
    // The socket can close in the instant between identifying and here; that close would be missed.
    if (!this.obs.identified) throw new PtzError('connection_closed', 'The connection to OBS closed while connecting');
    this.connected = true;
    this.emit('connected');
  }

  async disconnect() {
    this.connected = false;
    await this.obs.disconnect().catch(() => {});
  }

  /**
   * Call an obs-ptz proc. Resolves with the proc's response data; rejects with PtzError for
   * a not-connected client, a timeout, an obs-websocket level failure, or an error in the body.
   * @param {string} requestType
   * @param {Record<string, unknown>} [requestData]
   */
  async call(requestType, requestData = {}) {
    if (!this.connected) throw new PtzError('not_connected', 'Not connected to OBS');

    const pending = this.obs
      .call('CallVendorRequest', { vendorName: VENDOR_NAME, requestType, requestData })
      .catch((err) => {
        throw new PtzError('request_failed', err?.message ?? String(err));
      });
    pending.catch(() => {}); // a late rejection after a timeout must not be unhandled

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new PtzError('timeout', `No answer to ${requestType} within ${this.requestTimeoutMs} ms`)),
        this.requestTimeoutMs,
      );
    });

    try {
      const response = await Promise.race([pending, timeout]);
      const data = response?.responseData ?? {};
      if (data.error) throw new PtzError(data.error, data.message ?? data.error);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}
