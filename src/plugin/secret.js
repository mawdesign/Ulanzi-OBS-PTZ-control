// Obfuscation-grade protection for the stored OBS password: AES-256-GCM with a key derived from
// machine identity and OS user. It stops casual reads of the settings file, copying settings to
// another machine, and accidental leaks in logs/screenshots. It does NOT stop malware running as
// the same user. An OS keychain backend is planned.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import os from 'node:os';

const APP_SALT = 'obs-ptz-control/v1';
const PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function defaultKeyMaterial() {
  return `${os.hostname()}|${os.userInfo().username}|${os.homedir()}`;
}

const keyCache = new Map();
function deriveKey(material) {
  let key = keyCache.get(material);
  if (!key) {
    key = scryptSync(material, APP_SALT, 32);
    keyCache.set(material, key);
  }
  return key;
}

/** @returns {string} an opaque "v1:<base64>" token */
export function encryptSecret(plain, material = defaultKeyMaterial()) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(material), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

/** @throws if the token is malformed, tampered with, or was made with a different key */
export function decryptSecret(token, material = defaultKeyMaterial()) {
  if (typeof token !== 'string' || !token.startsWith(PREFIX)) throw new Error('Unrecognised secret format');
  const raw = Buffer.from(token.slice(PREFIX.length), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('Secret is truncated');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(material), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
