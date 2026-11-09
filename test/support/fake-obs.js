// A fake obs-websocket v5 server with the OBS-PTZ vendor bridge, for seam tests.
// Implements the real Hello/Identify handshake including password authentication, so the real
// obs-websocket-js client is exercised end to end.
import { WebSocketServer } from 'ws';
import { createHash, randomBytes } from 'node:crypto';

const sha256b64 = (s) => createHash('sha256').update(s).digest('base64');

// obs-websocket v5 op codes / close codes
const OP = { Hello: 0, Identify: 1, Identified: 2, Request: 6, RequestResponse: 7 };
const CLOSE_AUTH_FAILED = 4009;

export class FakeObs {
  /** @param {{ password?: string }} [opts] empty password = authentication disabled */
  constructor({ password = '' } = {}) {
    this.password = password;
    /** vendor requests received, in order: { requestType, requestData } */
    this.requests = [];
    /** identify payloads received (eventSubscriptions etc.) */
    this.identifies = [];
    this.handlers = new Map();
    this.sockets = new Set();
    this.selected = 'cam-uuid-1'; // null => no_selection
    this.silent = new Set(); // request types that never get an answer (timeout tests)
    this.#installDefaults();
  }

  #installDefaults() {
    this.handlers.set('ptz_stop', () => ({}));
  }

  /** Register a handler `(requestData) => responseData` for a vendor request type. */
  on(requestType, fn) {
    this.handlers.set(requestType, fn);
  }

  async start() {
    this.wss = new WebSocketServer({
      port: 0,
      handleProtocols: (protocols) => (protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false),
    });
    await new Promise((resolve) => this.wss.once('listening', resolve));
    this.port = this.wss.address().port;
    this.wss.on('connection', (ws) => this.#onConnection(ws));
  }

  async stop() {
    for (const ws of this.sockets) ws.terminate();
    await new Promise((resolve) => this.wss.close(resolve));
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
    this.requests.push({ requestType, requestData });
    if (this.silent.has(requestType)) return;

    const wrap = (inner) => this.#respond(ws, d, true, 100, { vendorName, requestType, responseData: inner });

    // OBS-PTZ failures are reported in the response data, not as an obs-websocket failure.
    if (requestData.device === 'selected' && this.selected == null) {
      return wrap({ error: 'no_selection', message: 'No camera is selected in the PTZ dock' });
    }
    const handler = this.handlers.get(requestType);
    if (!handler) return wrap({ error: 'no_such_proc', message: `No proc ${requestType}` });
    const answer = handler(requestData) ?? {};
    wrap(requestData.device === 'selected' && !answer.error ? { device: this.selected, ...answer } : answer);
  }
}
