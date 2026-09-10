import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { verifyWebhookSignature, normalizePem, extractSignature } from './webhook.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function sign(body: string): string {
  const s = createSign('RSA-SHA512');
  s.update(body);
  s.end();
  return s.sign(privateKey, 'base64');
}

test('принимает корректную подпись', () => {
  const body = '{"transactionId":"abc","status":"Paid"}';
  assert.equal(
    verifyWebhookSignature({ rawBody: body, signature: sign(body), publicKeyPem: pem }),
    true,
  );
});

test('отвергает подпись, если тело изменено хоть на символ', () => {
  const body = '{"amount":100}';
  const signature = sign(body);
  assert.equal(
    verifyWebhookSignature({ rawBody: '{"amount":1000}', signature, publicKeyPem: pem }),
    false,
  );
});

test('отвергает пустую подпись, а не падает', () => {
  assert.equal(verifyWebhookSignature({ rawBody: 'x', signature: '', publicKeyPem: pem }), false);
});

test('не падает на мусорном ключе', () => {
  assert.equal(
    verifyWebhookSignature({ rawBody: 'x', signature: 'AAAA', publicKeyPem: 'не ключ' }),
    false,
  );
});

test('normalizePem обрамляет голый base64', () => {
  const bare = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const restored = normalizePem(bare);
  assert.ok(restored.startsWith('-----BEGIN PUBLIC KEY-----'));

  const body = 'payload';
  assert.equal(
    verifyWebhookSignature({ rawBody: body, signature: sign(body), publicKeyPem: restored }),
    true,
  );
});

test('извлекает подпись независимо от регистра заголовка', () => {
  assert.equal(extractSignature({ 'X-Signature': 'sig1' }), 'sig1');
  assert.equal(extractSignature({ 'x-signature': 'sig2' }), 'sig2');
  assert.equal(extractSignature({ 'content-type': 'application/json' }), undefined);
});
