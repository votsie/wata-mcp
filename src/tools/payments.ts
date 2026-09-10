import { pathSegment } from '../core/url.js';
import { z } from 'zod';
import type { ToolDef } from './registry.js';

/** Транзакции, возвраты, платёжные ссылки, чарджбеки и подписки. */
export const paymentTools: ToolDef[] = [
  {
    name: 'wata_transaction_get',
    title: 'Детали транзакции',
    description: 'Полная карточка транзакции по идентификатору.',
    schema: { id: z.string().describe('Идентификатор транзакции') },
    handler: (a, { session }) => session.http.json(`/api/merchant/transactions/${pathSegment(a.id as string)}`),
  },
  {
    name: 'wata_transaction_refund',
    title: 'Возврат по транзакции',
    description:
      'НЕОБРАТИМАЯ ДЕНЕЖНАЯ ОПЕРАЦИЯ. Создаёт возврат по транзакции. ' +
      'Нужны только идентификатор исходной транзакции и сумма — валюта берётся из неё же. ' +
      'Для полного возврата передайте сумму, равную сумме исходной транзакции. ' +
      'Поля «причина возврата» в API нет.',
    mutating: true,
    schema: {
      originalTransactionId: z.string().describe('Идентификатор исходной оплаченной транзакции'),
      amount: z.number().positive().describe('Сумма возврата, не больше доступного остатка'),
      confirm: z
        .literal(true)
        .describe(
          'Подтверждение возврата. Передайте true только после того, как проверили ' +
            'транзакцию и сумму: отменить возврат невозможно',
        ),
    },
    handler: (a, { session }) => {
      // У возвратов, в отличие от вывода средств, нет подтверждения на стороне WATA.
      // Явный флаг — единственный барьер между опечаткой агента и реальными деньгами.
      if (a.confirm !== true) throw new Error('Возврат не подтверждён: передайте confirm: true');
      return session.http.json('/api/merchant/transactions/refunds', {
        method: 'POST',
        body: { originalTransactionId: a.originalTransactionId, amount: a.amount },
      });
    },
  },
  {
    name: 'wata_transaction_resend_webhook',
    title: 'Повторно отправить вебхук',
    description:
      'Просит WATA повторно доставить вебхук об оплате на адрес терминала. ' +
      'Удобно, когда ваш сервер не принял уведомление.',
    mutating: true,
    schema: { id: z.string().describe('Идентификатор транзакции') },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/transactions/${pathSegment(a.id as string)}/pay-webhook`, {
        method: 'POST',
      }),
  },
  {
    name: 'wata_link_get',
    title: 'Детали платёжной ссылки',
    description: 'Карточка платёжной ссылки по идентификатору.',
    schema: { id: z.string().describe('Идентификатор ссылки') },
    handler: (a, { session }) => session.http.json(`/api/merchant/links/${pathSegment(a.id as string)}`),
  },
  {
    name: 'wata_link_create',
    title: 'Создать платёжную ссылку через кабинет',
    description:
      'Создаёт платёжную ссылку от имени кабинета — без JWT-токена терминала. ' +
      'Удобно, когда токен ещё не выпущен: терминал указывается явно. ' +
      'Если вы интегрируете приём платежей в свой сервис, используйте wata_acq_link_create.',
    mutating: true,
    schema: {
      terminalId: z.string().describe('Терминал, для которого создаётся ссылка'),
      amount: z.number().positive().describe('Сумма платежа'),
      currency: z.string().describe('Валюта, например RUB'),
      description: z.string().optional().describe('Описание для плательщика'),
      orderId: z.string().optional().describe('Ваш идентификатор заказа'),
      expirationDateTime: z.string().optional().describe('Когда ссылка истекает, ISO 8601'),
      successRedirectUrl: z.string().optional(),
      failRedirectUrl: z.string().optional(),
    },
    handler: (a, { session }) => {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) if (v !== undefined) body[k] = v;
      return session.http.json('/api/merchant/links', { method: 'POST', body });
    },
  },
  {
    name: 'wata_link_close',
    title: 'Закрыть платёжную ссылку',
    description:
      'Закрывает платёжную ссылку, чтобы по ней больше нельзя было платить. ' +
      'Кабинет требует передать вместе со статусом сумму, валюту и терминал ссылки — ' +
      'возьмите их из wata_link_get. Создание ссылок делается через wata_acq_link_create.',
    mutating: true,
    schema: {
      id: z.string().describe('Идентификатор ссылки'),
      amount: z.number().describe('Сумма ссылки из wata_link_get'),
      currency: z.string().describe('Валюта ссылки из wata_link_get'),
      terminalId: z.string().describe('Терминал ссылки из wata_link_get'),
    },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/links/${pathSegment(a.id as string)}`, {
        method: 'PUT',
        body: {
          amount: a.amount,
          currency: a.currency,
          terminalId: a.terminalId,
          status: 'Closed',
        },
      }),
  },
  {
    name: 'wata_chargeback_get',
    title: 'Детали чарджбека',
    description: 'Карточка чарджбека по идентификатору.',
    schema: { id: z.string().describe('Идентификатор чарджбека') },
    handler: (a, { session }) => session.http.json(`/api/merchant/chargebacks/${pathSegment(a.id as string)}`),
  },
  {
    name: 'wata_subscription_get',
    title: 'Детали подписки',
    description: 'Карточка регулярного списания.',
    schema: { subscriptionId: z.string().describe('Идентификатор подписки') },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/subscriptions/${pathSegment(a.subscriptionId as string)}`),
  },
  {
    name: 'wata_subscription_set_status',
    title: 'Изменить статус подписки',
    description: 'Приостанавливает, возобновляет или отменяет подписку.',
    mutating: true,
    schema: {
      subscriptionId: z.string().describe('Идентификатор подписки'),
      payload: z.record(z.unknown()).describe('Новый статус, например { status: "Cancelled" }'),
    },
    handler: (a, { session }) =>
      session.http.json(`/api/merchant/subscriptions/${pathSegment(a.subscriptionId as string)}/statuses`, {
        method: 'POST',
        body: a.payload,
      }),
  },
];
