// SPIKE: log every Ulanzi Studio event verbatim so we can confirm real event/payload behaviour
// (does `run` also fire after a hold? what do dialrotate payloads look like?) before writing features.
import { UlanziApi } from '../vendor/ulanzi-api/index.js';

const MAIN_UUID = 'com.ulanzi.ulanzistudio.obsptz';
const $UD = new UlanziApi();

const log = (tag, data) => {
  const line = `[obsptz-spike] ${new Date().toISOString()} ${tag} ${JSON.stringify(data)}`;
  console.warn(line);
  $UD.logMessage(line, 'info');
};

$UD.connect(MAIN_UUID);

$UD.onConnected((m) => log('connected', m));
$UD.onClose(() => log('close', {}));
$UD.onError((e) => log('error', e));
$UD.onAdd((m) => log('add', m));
$UD.onRun((m) => log('run', m));
$UD.onKeyDown((m) => log('keydown', m));
$UD.onKeyUp((m) => log('keyup', m));
$UD.onSetActive((m) => log('setactive', m));
$UD.onClear((m) => log('clear', m));
$UD.onParamFromApp((m) => log('paramfromapp', m));
$UD.onParamFromPlugin((m) => log('paramfromplugin', m));
$UD.onDialDown((m) => log('dialdown', m));
$UD.onDialUp((m) => log('dialup', m));
$UD.onDialRotate((m) => log('dialrotate', m));
$UD.onSendToPlugin((m) => log('sendToPlugin', m));
$UD.onDidReceiveGlobalSettings((m) => log('didReceiveGlobalSettings', m));
