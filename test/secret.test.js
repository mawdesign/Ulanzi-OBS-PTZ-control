import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/plugin/secret.js';

test('round trip returns the original secret', () => {
  assert.equal(decryptSecret(encryptSecret('hunter2', 'k1'), 'k1'), 'hunter2');
});

test('ciphertext does not contain the plaintext and differs per call', () => {
  const a = encryptSecret('hunter2', 'k1');
  const b = encryptSecret('hunter2', 'k1');
  assert.ok(!a.includes('hunter2'));
  assert.notEqual(a, b);
});

test('a wrong key is rejected', () => {
  assert.throws(() => decryptSecret(encryptSecret('hunter2', 'k1'), 'k2'));
});

test('tampered data is rejected', () => {
  const token = encryptSecret('hunter2', 'k1');
  const raw = Buffer.from(token.slice(3), 'base64');
  raw[raw.length - 1] ^= 0xff;
  assert.throws(() => decryptSecret('v1:' + raw.toString('base64'), 'k1'));
});

test('malformed tokens are rejected', () => {
  assert.throws(() => decryptSecret('nonsense', 'k1'));
  assert.throws(() => decryptSecret('v1:AAAA', 'k1'));
});
