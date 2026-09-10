import { createVerify } from 'node:crypto';

/**
 * Проверка подписи вебхука WATA.
 *
 * Подтверждено по документации и по реально полученному ключу:
 *  - подпись лежит в заголовке `X-Signature`, в base64;
 *  - алгоритм — SHA512withRSA (RSA PKCS#1 v1.5 + SHA-512), НЕ SHA-256;
 *  - ключ отдаётся эндпоинтом `/api/h2h/public-key` в поле `value` как PEM.
 *    Документация называет его «PKCS1», но фактически это X.509 SubjectPublicKeyInfo —
 *    `createVerify` разбирает такой PEM корректно.
 *
 * Проверять нужно СЫРОЕ тело запроса. Если разобрать JSON и собрать обратно,
 * изменится порядок ключей и пробелы, и подпись перестанет сходиться — поэтому
 * в веб-фреймворке сохраняйте raw body до парсинга.
 */

export const SIGNATURE_HEADER = 'X-Signature';
export const WEBHOOK_ALGORITHM = 'RSA-SHA512';

export interface VerifyOptions {
  /** Сырое тело запроса ровно в том виде, в каком оно пришло. */
  rawBody: string | Buffer;
  /** Значение заголовка X-Signature. */
  signature: string;
  /** Публичный ключ WATA (поле value из /api/h2h/public-key). */
  publicKeyPem: string;
  /** По умолчанию RSA-SHA512 — так подписывает WATA. */
  algorithm?: string;
  encoding?: 'base64' | 'hex';
}

export function verifyWebhookSignature(options: VerifyOptions): boolean {
  const {
    rawBody,
    signature,
    publicKeyPem,
    algorithm = WEBHOOK_ALGORITHM,
    encoding = 'base64',
  } = options;

  if (!signature || !publicKeyPem) return false;

  try {
    const verifier = createVerify(algorithm);
    verifier.update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody);
    verifier.end();
    return verifier.verify(normalizePem(publicKeyPem), signature.trim(), encoding);
  } catch {
    // Некорректный ключ или подпись — это провал проверки, а не аварийная ситуация.
    return false;
  }
}

const LITERAL_NEWLINE = new RegExp(String.raw`\\n`, 'g');

/** Приводит ключ к PEM: сервер может отдать «голый» base64 без заголовков. */
export function normalizePem(key: string): string {
  const trimmed = key.trim();

  // Ключ, пришедший из переменной окружения или из JSON без разбора, часто содержит
  // ДВУХСИМВОЛЬНУЮ последовательность «\n» вместо настоящих переносов строк.
  // createVerify такой PEM не примет, поэтому восстанавливаем переносы.
  if (trimmed.includes('-----BEGIN')) return trimmed.replace(LITERAL_NEWLINE, '\n');

  const body = trimmed.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

const SIGNATURE_HEADERS = ['x-signature', 'signature', 'x-wata-signature'];

/** Достаёт подпись из заголовков, не полагаясь на регистр. */
export function extractSignature(headers: Record<string, unknown>): string | undefined {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  for (const name of SIGNATURE_HEADERS) {
    const value = lower[name];
    if (typeof value === 'string' && value) return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return undefined;
}
