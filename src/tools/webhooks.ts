import { z } from 'zod';
import { WataAcqHttp, acqBaseUrl } from '../core/acq-http.js';
import { verifyWebhookSignature, SIGNATURE_HEADER, WEBHOOK_ALGORITHM } from '../core/webhook.js';
import type { ToolDef } from './registry.js';

/**
 * Вебхуки WATA.
 *
 * Эндпоинт публичного ключа — единственный в публичном API, который работает
 * БЕЗ авторизации, поэтому здесь допускается запрос без токена.
 *
 * У prod и sandbox РАЗНЫЕ ключи: кэшировать один ключ для обоих окружений нельзя.
 */

/** Ключ меняется редко, но окружения различаются — кэшируем по базовому адресу. */
const keyCache = new Map<string, string>();

async function fetchPublicKey(force = false): Promise<string> {
  const base = acqBaseUrl();
  if (!force) {
    const cached = keyCache.get(base);
    if (cached) return cached;
  }

  // Единственная операция публичного API, объявленная без авторизации.
  const client = new WataAcqHttp(undefined, base);
  const res = (await client.json('/api/h2h/public-key', { anonymous: true })) as
    | { value?: string }
    | string;
  const value = typeof res === 'string' ? res : res?.value;
  if (!value) throw new Error('WATA не вернула публичный ключ');

  keyCache.set(base, value);
  return value;
}

export const webhookTools: ToolDef[] = [
  {
    name: 'wata_webhook_public_key',
    title: 'Публичный ключ для проверки вебхуков',
    description:
      'Получает публичный RSA-ключ WATA в формате PEM. Авторизация не требуется. ' +
      'У боевого окружения и песочницы ключи РАЗНЫЕ — окружение выбирается переменной WATA_ENV.',
    schema: {
      refresh: z.boolean().optional().describe('Запросить заново, минуя кэш'),
    },
    handler: async (a) => ({
      environment: process.env.WATA_ENV === 'sandbox' ? 'sandbox' : 'production',
      baseUrl: acqBaseUrl(),
      algorithm: WEBHOOK_ALGORITHM,
      signatureHeader: SIGNATURE_HEADER,
      publicKey: await fetchPublicKey(Boolean(a.refresh)),
    }),
  },
  {
    name: 'wata_webhook_verify',
    title: 'Проверить подпись вебхука',
    description:
      'Проверяет подлинность уведомления WATA: подпись из заголовка X-Signature по алгоритму ' +
      'SHA512withRSA. Передавайте СЫРОЕ тело запроса — ровно ту строку, что пришла по сети. ' +
      'Если разобрать JSON и собрать обратно, порядок ключей и пробелы изменятся, и проверка ' +
      'провалится на подлинном уведомлении. Ключ подтягивается автоматически, если не передан.',
    schema: {
      rawBody: z.string().describe('Сырое тело запроса как строка'),
      signature: z.string().describe('Значение заголовка X-Signature'),
      publicKeyPem: z.string().optional().describe('Ключ PEM; по умолчанию берётся из API'),
    },
    handler: async (a) => {
      const publicKeyPem = (a.publicKeyPem as string) || (await fetchPublicKey());
      const valid = verifyWebhookSignature({
        rawBody: a.rawBody as string,
        signature: a.signature as string,
        publicKeyPem,
      });

      return {
        valid,
        algorithm: WEBHOOK_ALGORITHM,
        environment: process.env.WATA_ENV === 'sandbox' ? 'sandbox' : 'production',
        hint: valid
          ? 'Подпись верна — уведомление действительно отправлено WATA.'
          : 'Подпись не сошлась. Частые причины: тело было разобрано и собрано заново вместо ' +
            'сырого; перепутаны окружения (у песочницы свой ключ); подпись взята не из заголовка X-Signature.',
      };
    },
  },
  {
    name: 'wata_webhook_guide',
    title: 'Как принимать вебхуки WATA',
    description:
      'Возвращает справку по приёму уведомлений: где задать адрес, что вернуть в ответ, ' +
      'какие бывают события и как проверять подпись. Полезно перед написанием обработчика.',
    schema: {},
    handler: async () => ({
      setup:
        'Адрес вебхука задаётся отдельно для каждого терминала в личном кабинете. ' +
        'Текущее значение видно в wata_terminal_get (поле webHookUrl). ' +
        'У боевого кабинета и песочницы адреса настраиваются независимо.',
      events: {
        prepayment: 'Предоплатный — до обращения в банк. Момент, когда можно отказать в оплате.',
        postpayment: 'Постоплатный — после результата оплаты.',
        refund: 'Возвратный — после результата возврата.',
      },
      response: 'Ваш обработчик должен вернуть HTTP 200. Любой другой ответ считается сбоем доставки.',
      signature: {
        header: SIGNATURE_HEADER,
        algorithm: WEBHOOK_ALGORITHM,
        encoding: 'base64',
        keyEndpoint: `${acqBaseUrl()}/api/h2h/public-key`,
        critical:
          'Проверяйте подпись на СЫРОМ теле запроса, до разбора JSON. Без проверки подписи ' +
          'кто угодно может прислать вам поддельное уведомление об оплате.',
      },
      fieldNaming:
        'В payload вебхука комиссия приходит как commission, а в ответе ' +
        'GET /api/h2h/transactions/{id} то же значение называется totalCommission.',
      resend:
        'Если уведомление не дошло, повторную доставку можно запросить через ' +
        'wata_transaction_resend_webhook (инструмент кабинета).',
    }),
  },
];
