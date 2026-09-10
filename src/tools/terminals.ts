import { pathSegment } from '../core/url.js';
import { z } from 'zod';
import type { ToolDef } from './registry.js';

/**
 * Терминалы и их API-токены.
 *
 * Важно для понимания модели доступа WATA: JWT публичного API выпускается
 * ЗДЕСЬ и действует только в рамках одного терминала. Именно поэтому полный
 * контроль над аккаунтом возможен только через сессию кабинета.
 */
export const terminalTools: ToolDef[] = [
  {
    name: 'wata_terminal_rates',
    title: 'Ставки терминала',
    description: 'Комиссии WATA по всем методам оплаты для указанного терминала.',
    schema: { terminalId: z.string().describe('Идентификатор терминала') },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/terminals/${pathSegment(a.terminalId as string)}/all-rates`),
  },
  {
    name: 'wata_terminal_payer_rates_set',
    title: 'Ставки, перекладываемые на плательщика',
    description:
      'Задаёт, какая часть комиссии по конкретному методу оплаты перекладывается на плательщика. ' +
      'Ставка меняется по одному методу за вызов. Доступные методы смотрите в wata_terminal_rates.',
    mutating: true,
    schema: {
      terminalId: z.string().describe('Идентификатор терминала'),
      transactionType: z.string().describe('Метод оплаты, например SBP или TPay'),
      rate: z.number().min(0).describe('Новое значение ставки для плательщика'),
    },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/terminals/${pathSegment(a.terminalId as string)}/payer-rates`, {
        method: 'PUT',
        body: { transactionType: a.transactionType, rate: a.rate },
      }),
  },
  {
    name: 'wata_terminal_api_tokens_list',
    title: 'API-токены терминала',
    description:
      'Список выпущенных JWT-токенов публичного API для терминала (сами значения токенов сервер обычно не возвращает повторно).',
    schema: { terminalId: z.string().describe('Идентификатор терминала') },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/terminals/${pathSegment(a.terminalId as string)}/api-tokens`),
  },
  {
    name: 'wata_terminal_api_token_create',
    title: 'Выпустить API-токен терминала',
    description:
      'Создаёт новый JWT для публичного API эквайринга. Значение токена показывается один раз — ' +
      'сохраните его сразу в WATA_ACQ_TOKEN. На терминал допускается от одного до пяти токенов, ' +
      'срок действия от 1 до 12 месяцев. Токен работает только с согласованных с WATA IP-адресов.',
    mutating: true,
    schema: {
      terminalId: z.string().describe('Идентификатор терминала'),
      name: z.string().describe('Название токена, чтобы отличать его от других'),
      expirationMonths: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe('Срок действия в месяцах, по умолчанию 12'),
    },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/terminals/${pathSegment(a.terminalId as string)}/api-tokens`, {
        method: 'POST',
        body: { name: a.name, expirationMonths: a.expirationMonths ?? 12 },
      }),
  },
  {
    name: 'wata_terminal_api_token_revoke',
    title: 'Отозвать API-токен терминала',
    description: 'Безвозвратно отзывает выпущенный JWT публичного API.',
    mutating: true,
    schema: {
      terminalId: z.string().describe('Идентификатор терминала'),
      tokenId: z.string().describe('Идентификатор токена из wata_terminal_api_tokens_list'),
    },
    handler: (a, { session }) =>
      session.http.json(
        `/api/merchant/terminals/${pathSegment(a.terminalId as string)}/api-tokens/${pathSegment(a.tokenId as string)}`,
        { method: 'DELETE' },
      ),
  },
  {
    name: 'wata_terminal_update',
    title: 'Настройки терминала и вебхуков',
    description:
      'Меняет настройки боевого терминала: адрес вебхука, страницы успеха и ошибки, ' +
      'а также какие именно уведомления слать. Это основной способ подключить приём вебхуков. ' +
      'Передавайте только те поля, которые нужно изменить. ' +
      'ВНИМАНИЕ: предоплатный вебхук (sendPrePayWebhook) требует ответа за 10 секунд — ' +
      'если ваш сервер не ответит, транзакция будет отклонена без обращения в банк.',
    mutating: true,
    schema: {
      terminalId: z.string().describe('Идентификатор терминала'),
      webhookUrl: z.string().optional().describe('Адрес приёма уведомлений'),
      successPageUrl: z.string().optional().describe('Страница после успешной оплаты'),
      failPageUrl: z.string().optional().describe('Страница после неудачной оплаты'),
      sendPayWebhook: z.boolean().optional().describe('Слать постоплатный вебхук'),
      sendPayWebhookOnDecline: z
        .boolean()
        .optional()
        .describe('Слать вебхук и по отклонённым платежам'),
      sendPrePayWebhook: z
        .boolean()
        .optional()
        .describe('Слать предоплатный вебхук: ответ обязателен за 10 секунд'),
      sendRefundWebhook: z.boolean().optional().describe('Слать вебхук о возвратах'),
    },
    handler: (a, { session }) => {
      const body: Record<string, unknown> = {};
      for (const key of [
        'webhookUrl',
        'successPageUrl',
        'failPageUrl',
        'sendPayWebhook',
        'sendPayWebhookOnDecline',
        'sendPrePayWebhook',
        'sendRefundWebhook',
      ]) {
        if (a[key] !== undefined) body[key] = a[key];
      }
      if (Object.keys(body).length === 0) {
        throw new Error('Не передано ни одного поля для изменения');
      }
      return session.http.json(`/api/merchant/terminals/live/${pathSegment(a.terminalId as string)}`, {
        method: 'PATCH',
        body,
      });
    },
  },
  {
    name: 'wata_terminal_test',
    title: 'Тестовый режим терминала',
    description: 'Переключает терминал в тестовый режим или обратно.',
    mutating: true,
    schema: {
      terminalId: z.string().describe('Идентификатор терминала'),
      payload: z.record(z.unknown()).optional().describe('Параметры переключения'),
    },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/terminals/test/${pathSegment(a.terminalId as string)}`, {
        method: 'PUT',
        body: a.payload ?? {},
      }),
  },
];
