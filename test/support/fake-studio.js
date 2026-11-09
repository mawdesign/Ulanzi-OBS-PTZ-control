// A fake Ulanzi Studio: the WebSocket server the plugin's main service connects to.
// Behaviour mirrors the SDK's UlanziDeckSimulator (global settings round trip, pass-through messages).
import { WebSocketServer } from 'ws';
import { waitFor } from './wait.js';

export const MAIN_UUID = 'com.ulanzi.ulanzistudio.obsptz';
export const ctx = ({ uuid, key, actionid }) => `${uuid}___${key}___${actionid}`;

export class FakeStudio {
  constructor() {
    /** every message the plugin sent, except protocol acks (messages carrying `code`) */
    this.sent = [];
    this.globalSettings = undefined;
    this.main = null;
  }

  async start() {
    this.wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => this.wss.once('listening', resolve));
    this.port = this.wss.address().port;
    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => this.#onMessage(ws, JSON.parse(raw.toString())));
    });
  }

  async stop() {
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise((resolve) => this.wss.close(resolve));
  }

  #onMessage(ws, msg) {
    if (msg.cmd === 'connected' && msg.uuid === MAIN_UUID) {
      this.main = ws;
      return;
    }
    if (msg.code !== undefined) return; // ack of one of our messages
    this.sent.push(msg);
    if (msg.cmd === 'setGlobalSettings') this.globalSettings = msg.settings;
    if (msg.cmd === 'getGlobalSettings') {
      ws.send(JSON.stringify({ cmd: 'didReceiveGlobalSettings', uuid: MAIN_UUID, actionid: '', key: '', settings: this.globalSettings }));
    }
  }

  async ready() {
    await waitFor(() => this.main?.readyState === 1, 'plugin to connect to Studio');
    await waitFor(() => this.sent.some((m) => m.cmd === 'getGlobalSettings'), 'plugin to request global settings');
  }

  push(message) {
    this.main.send(JSON.stringify(message));
  }

  /** Simulate the inspector (or Studio) changing global settings. */
  setGlobalSettings(settings) {
    this.globalSettings = settings;
    this.push({ cmd: 'didReceiveGlobalSettings', uuid: MAIN_UUID, actionid: '', key: '', settings });
  }

  /** Place an action on a key. Returns its context. */
  add(kind, { key = '0_0', actionid = `${kind}-${key}`, param = {} } = {}) {
    const a = { uuid: `${MAIN_UUID}.${kind}`, key, actionid };
    this.push({ cmd: 'add', ...a, param });
    return ctx(a);
  }

  target(context) {
    const [uuid, key, actionid] = context.split('___');
    return { uuid, key, actionid };
  }

  run(context) {
    this.push({ cmd: 'run', ...this.target(context) });
  }

  clear(...contexts) {
    this.push({ cmd: 'clear', param: contexts.map((c) => this.target(c)) });
  }

  /** Inspector → plugin pass-through. */
  sendToPlugin(context, payload) {
    this.push({ cmd: 'sendToPlugin', ...this.target(context), payload });
  }

  /** The key state (0 normal, 1 disconnected) last set for a context, or undefined. */
  stateOf(context) {
    const item = (m) => m.param.statelist[0];
    return this.sent.filter((m) => m.cmd === 'state' && ctx(item(m)) === context).map((m) => item(m).state).at(-1);
  }

  /** Messages the plugin sent with the given cmd (optionally for one context). */
  commands(cmd, context) {
    return this.sent.filter((m) => m.cmd === cmd && (!context || ctx(m) === context));
  }
}
