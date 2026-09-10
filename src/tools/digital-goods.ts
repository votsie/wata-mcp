import { pathSegment } from '../core/url.js';
import { z } from 'zod';
import { WataAcqHttp, DG_BASE_URL } from '../core/acq-http.js';
import type { ToolDef } from './registry.js';

/**
 * Публичный API цифровых товаров (https://dg-api.wata.pro/api).
 *
 * Здесь два независимых способа оплаты, и от выбранного зависит путь эндпоинта:
 *  - Acquiring — заказ оплачивает конечный покупатель (пути /api/v3/... и /api/stars/...);
 *  - Deposit   — заказ списывается с депозитного баланса мерчанта (пути /api/v1/deposit/...).
 * Перепутать их легко, поэтому у инструментов явный параметр payment.
 */

/**
 * Один клиент на процесс: вместе с ним живёт троттлер. Пересоздание на каждый
 * вызов сбрасывало бы отсчёт паузы, и запросы уходили бы без ограничения частоты.
 */
let client: WataAcqHttp | undefined;
let clientToken: string | undefined;

const dg = (): WataAcqHttp => {
  const token = process.env.WATA_ACQ_TOKEN;
  if (!client || clientToken !== token) {
    client = new WataAcqHttp(token, DG_BASE_URL);
    clientToken = token;
  }
  return client;
};

const paymentShape = {
  payment: z
    .enum(['acquiring', 'deposit'])
    .describe('acquiring — платит покупатель; deposit — списывается с депозита мерчанта'),
} satisfies z.ZodRawShape;

export const digitalGoodsTools: ToolDef[] = [
  // ------------------------------------------------------------------ Steam
  {
    name: 'wata_dg_steam_price',
    title: 'Стоимость пополнения Steam',
    description:
      'Считает стоимость пополнения Steam-аккаунта. Два сценария: по желаемой сумме зачисления ' +
      'на аккаунт либо по сумме платежа — выберите режим параметром by.',
    schema: {
      ...paymentShape,
      login: z.string().optional().describe('Логин Steam-аккаунта'),
      amount: z.number().positive().describe('Сумма: зачисления или платежа, в зависимости от by'),
      by: z
        .enum(['netAmount', 'price'])
        .optional()
        .describe('netAmount — задана сумма зачисления; price — задана сумма платежа'),
      currency: z.string().optional().describe('Валюта, например RUB'),
    },
    handler: (a) => {
      const byPrice = a.by === 'price';
      const path =
        a.payment === 'deposit'
          ? byPrice
            ? '/api/v1/steam/deposit/netamount'
            : '/api/v1/steam/deposit/price'
          : byPrice
            ? '/api/v3/steam/by-amount'
            : '/api/v3/steam/amount';
      return dg().json(path, {
        query: { login: a.login, amount: a.amount, currency: a.currency },
      });
    },
  },
  {
    name: 'wata_dg_steam_order_create',
    title: 'Заказ на пополнение Steam',
    description:
      'Создаёт заказ на пополнение Steam-аккаунта. При payment=acquiring в ответе будет ссылка ' +
      'на оплату для покупателя; при payment=deposit сумма спишется с депозитного баланса мерчанта.',
    mutating: true,
    schema: {
      ...paymentShape,
      by: z
        .enum(['netAmount', 'price'])
        .optional()
        .describe('netAmount — задана сумма зачисления; price — задана сумма платежа'),
      payload: z.record(z.unknown()).describe('Тело заказа: логин, сумма, валюта, ваш orderId'),
    },
    handler: (a) => {
      const byPrice = a.by === 'price';
      const path =
        a.payment === 'deposit'
          ? byPrice
            ? '/api/v1/steam/deposit/by-price'
            : '/api/v1/steam/deposit'
          : byPrice
            ? '/api/v3/steam/by-amount'
            : '/api/v3/steam';
      return dg().json(path, { method: 'POST', body: a.payload });
    },
  },
  {
    name: 'wata_dg_steam_order_get',
    title: 'Статус заказа Steam',
    description:
      'Проверяет статус заказа на пополнение Steam. Укажите тот же payment, ' +
      'что и при создании: у депозитных заказов статус лежит по общему адресу, ' +
      'а не по адресу направления.',
    schema: {
      ...paymentShape,
      id: z.string().describe('Идентификатор заказа'),
    },
    handler: (a) => {
      const id = pathSegment(a.id as string);
      return dg().json(
        a.payment === 'deposit' ? `/api/v1/deposit/order/${id}` : `/api/v3/steam/order/${id}`,
      );
    },
  },

  // ---------------------------------------------------------- Telegram Stars
  {
    name: 'wata_dg_stars_price',
    title: 'Стоимость Telegram Stars',
    description: 'Возвращает стоимость покупки звёзд и минимально допустимое количество.',
    schema: {
      quantity: z.number().int().positive().optional().describe('Количество звёзд'),
      username: z.string().optional().describe('Получатель в Telegram'),
    },
    handler: (a) =>
      dg().json('/api/stars/price', { query: { quantity: a.quantity, username: a.username } }),
  },
  {
    name: 'wata_dg_stars_order_create',
    title: 'Заказ на покупку Telegram Stars',
    description:
      'Создаёт заказ на покупку звёзд. Заказ может попасть в статус Review — тогда его нужно ' +
      'явно подтвердить (wata_dg_stars_order_confirm) или отклонить.',
    mutating: true,
    schema: { payload: z.record(z.unknown()).describe('Получатель, количество звёзд, ваш orderId') },
    handler: (a) => dg().json('/api/stars', { method: 'POST', body: a.payload }),
  },
  {
    name: 'wata_dg_stars_order_confirm',
    title: 'Подтвердить заказ Telegram Stars',
    description: 'Подтверждает заказ, находящийся в статусе Review.',
    mutating: true,
    schema: { id: z.string().describe('Идентификатор заказа') },
    handler: (a) => dg().json(`/api/stars/order/${pathSegment(a.id as string)}/confirm`, { method: 'POST' }),
  },
  {
    name: 'wata_dg_stars_order_reject',
    title: 'Отклонить заказ Telegram Stars',
    description: 'Отменяет заказ, находящийся в статусе Review.',
    mutating: true,
    schema: { id: z.string().describe('Идентификатор заказа') },
    handler: (a) => dg().json(`/api/stars/order/${pathSegment(a.id as string)}/reject`, { method: 'POST' }),
  },
  {
    name: 'wata_dg_stars_order_get',
    title: 'Статус заказа Telegram Stars',
    description: 'Проверяет статус заказа на покупку звёзд.',
    schema: { id: z.string().describe('Идентификатор заказа') },
    handler: (a) => dg().json(`/api/stars/order/${pathSegment(a.id as string)}`),
  },

  // ------------------------------------------------------------ Top-Up и ваучеры
  {
    name: 'wata_dg_catalog',
    title: 'Каталог пополнений и ваучеров',
    description:
      'Список доступных позиций: для topup — игры и внутриигровые позиции, для vouchers — ' +
      'сервисы и номиналы ваучеров. Набор зависит от способа оплаты.',
    schema: {
      ...paymentShape,
      kind: z.enum(['topup', 'vouchers']).describe('Направление каталога'),
    },
    handler: (a) => {
      const path =
        a.payment === 'deposit'
          ? a.kind === 'topup'
            ? '/api/v1/deposit/topups'
            : '/api/v1/deposit/vouchers'
          : a.kind === 'topup'
            ? '/api/v3/topup/all'
            : '/api/v3/vouchers/all';
      return dg().json(path);
    },
  },
  {
    name: 'wata_dg_order_create',
    title: 'Заказ пополнения или ваучеров',
    description:
      'Создаёт заказ на покупку игровой позиции (topup) или ваучеров (vouchers). ' +
      'Позицию берите из wata_dg_catalog с тем же значением payment.',
    mutating: true,
    schema: {
      ...paymentShape,
      kind: z.enum(['topup', 'vouchers']).describe('Направление заказа'),
      payload: z.record(z.unknown()).describe('Тело заказа: позиция, количество, ваш orderId'),
    },
    handler: (a) => {
      const path =
        a.payment === 'deposit'
          ? a.kind === 'topup'
            ? '/api/v1/deposit/topups'
            : '/api/v1/deposit/vouchers'
          : a.kind === 'topup'
            ? '/api/v3/topup'
            : '/api/v3/vouchers';
      return dg().json(path, { method: 'POST', body: a.payload });
    },
  },
  {
    name: 'wata_dg_order_get',
    title: 'Статус заказа (topup или ваучеры)',
    description:
      'Проверяет статус заказа. Для ваучеров с оплатой acquiring здесь же возвращаются коды ваучеров.',
    schema: {
      ...paymentShape,
      kind: z.enum(['topup', 'vouchers']).optional().describe('Нужно только для payment=acquiring'),
      id: z.string().describe('Идентификатор заказа'),
    },
    handler: (a) => {
      const id = a.id as string;
      // У депозитных заказов один общий эндпоинт статуса для всех направлений.
      const path =
        a.payment === 'deposit'
          ? `/api/v1/deposit/order/${id}`
          : a.kind === 'vouchers'
            ? `/api/v3/vouchers/order/${id}`
            : `/api/v3/topup/orders/${id}`;
      return dg().json(path);
    },
  },
  {
    name: 'wata_dg_deposit_balance',
    title: 'Депозитный баланс',
    description:
      'Текущий остаток депозитного баланса мерчанта — из него оплачиваются заказы с payment=deposit. ' +
      'Это отдельный баланс, не совпадающий с кошельком кабинета.',
    schema: {},
    handler: () => dg().json('/api/v1/deposit/balance'),
  },
];
