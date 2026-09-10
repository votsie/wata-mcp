import { pathSegment } from '../core/url.js';
import { z } from 'zod';
import { WataAcqHttp } from '../core/acq-http.js';
import type { ToolDef } from './registry.js';

/**
 * Публичный H2H API эквайринга (https://api.wata.pro/api/h2h).
 *
 * Схемы полей взяты из настоящего OpenAPI-контракта WATA. Ключевое отличие от
 * кабинета: авторизация Bearer JWT, токен привязан к ОДНОМУ терминалу, и сам
 * терминал нигде не указывается явно — он определяется токеном.
 */

/**
 * Клиент создаётся один раз на процесс, а не на каждый вызов инструмента:
 * вместе с ним живёт троттлер, иначе паузы между запросами не было бы вовсе
 * и агент бил бы по API без ограничений. Токен читается лениво, чтобы
 * переменная окружения могла появиться уже после старта сервера.
 */
let client: WataAcqHttp | undefined;
let clientToken: string | undefined;

const acq = (): WataAcqHttp => {
  const token = process.env.WATA_ACQ_TOKEN;
  if (!client || clientToken !== token) {
    client = new WataAcqHttp(token);
    clientToken = token;
  }
  return client;
};

const CURRENCIES = ['RUB', 'USD', 'EUR'] as const;
const LINK_STATUSES = ['Opened', 'Closed'] as const;
const TX_STATUSES = ['Created', 'Paid', 'Pending', 'Declined'] as const;

export const acquiringTools: ToolDef[] = [
  {
    name: 'wata_acq_link_create',
    title: 'Создать платёжную ссылку',
    description:
      'Создаёт платёжную ссылку через публичный API. Ссылка создаётся для терминала, которому ' +
      'принадлежит токен WATA_ACQ_TOKEN — отдельно терминал не указывается. ' +
      'В ответе поле url можно сразу отдавать плательщику. ' +
      'Ограничения: сумма от 10 RUB (1 USD/EUR) до 999999.99; срок жизни от 10 минут до 30 дней, ' +
      'по умолчанию 3 дня. Точные лимиты шлюза уточняются у менеджера WATA.',
    mutating: true,
    schema: {
      amount: z.number().positive().describe('Сумма платежа'),
      currency: z.enum(CURRENCIES).describe('Валюта платежа'),
      description: z.string().optional().describe('Описание для плательщика'),
      orderId: z.string().optional().describe('Ваш идентификатор заказа'),
      successRedirectUrl: z.string().optional().describe('Куда вернуть после успешной оплаты'),
      failRedirectUrl: z.string().optional().describe('Куда вернуть после неудачной оплаты'),
      expirationDateTime: z
        .string()
        .optional()
        .describe('Когда ссылка истекает, ISO 8601; от 10 минут до 30 дней, по умолчанию 3 дня'),
      type: z
        .enum(['OneTime', 'ManyTime'])
        .optional()
        .describe('OneTime — оплата один раз, ManyTime — многоразовая ссылка'),
      isArbitraryAmountAllowed: z
        .boolean()
        .optional()
        .describe('Разрешить плательщику самому указать сумму'),
      arbitraryAmountPrompts: z
        .array(z.number())
        .optional()
        .describe('Подсказки сумм: рекомендуется 3-4, максимум 6; каждая не меньше amount'),
      email: z.string().optional().describe('Почта плательщика'),
      phone: z.string().optional().describe('Телефон плательщика'),
      username: z.string().optional().describe('Имя пользователя в вашей системе'),
      userId: z.string().optional().describe('Идентификатор пользователя в вашей системе'),
      subscription: z
        .object({
          period: z.number().int().describe('Длина периода'),
          interval: z.enum(['Test', 'Week', 'Month']).describe('Единица периода'),
          maxPeriods: z.number().int().describe('Сколько периодов списывать'),
          amount: z.number().positive().describe('Сумма регулярного списания'),
          startDate: z.string().optional().describe('Дата первого списания, ISO 8601'),
        })
        .optional()
        .describe('Превращает ссылку в подписку с регулярными списаниями'),
    },
    handler: (a) =>
      acq().json('/api/h2h/links', {
        method: 'POST',
        body: stripUndefined({
          amount: a.amount,
          currency: a.currency,
          description: a.description,
          orderId: a.orderId,
          successRedirectUrl: a.successRedirectUrl,
          failRedirectUrl: a.failRedirectUrl,
          expirationDateTime: a.expirationDateTime,
          type: a.type,
          isArbitraryAmountAllowed: a.isArbitraryAmountAllowed,
          arbitraryAmountPrompts: a.arbitraryAmountPrompts,
          email: a.email,
          phone: a.phone,
          username: a.username,
          userId: a.userId,
          subscription: a.subscription,
        }),
      }),
  },
  {
    name: 'wata_acq_links_find',
    title: 'Поиск платёжных ссылок',
    description:
      'Ищет платёжные ссылки терминала. Пагинация постраничная: skipCount и maxResultCount — ' +
      'в отличие от поиска транзакций, где используется курсор.',
    schema: {
      orderId: z.string().optional().describe('Фильтр по вашему идентификатору заказа'),
      creationTimeFrom: z.string().optional().describe('Создано с, ISO 8601'),
      creationTimeTo: z.string().optional().describe('Создано по, ISO 8601'),
      amountFrom: z.number().optional().describe('Сумма от'),
      amountTo: z.number().optional().describe('Сумма до'),
      currencies: z.array(z.enum(CURRENCIES)).optional().describe('Фильтр по валютам'),
      statuses: z.array(z.enum(LINK_STATUSES)).optional().describe('Фильтр по статусам'),
      sorting: z
        .string()
        .optional()
        .describe('Поле сортировки: orderId, creationTime, amount; суффикс desc для убывания'),
      skipCount: z.number().int().min(0).optional(),
      maxResultCount: z.number().int().min(1).max(1000).optional(),
    },
    handler: (a) =>
      acq().json('/api/h2h/links', {
        query: {
          OrderId: a.orderId,
          CreationTimeFrom: a.creationTimeFrom,
          CreationTimeTo: a.creationTimeTo,
          AmountFrom: a.amountFrom,
          AmountTo: a.amountTo,
          Currencies: a.currencies,
          Statuses: a.statuses,
          Sorting: a.sorting,
          SkipCount: a.skipCount ?? 0,
          MaxResultCount: a.maxResultCount ?? 20,
        },
      }),
  },
  {
    name: 'wata_acq_link_get',
    title: 'Платёжная ссылка по идентификатору',
    description:
      'Возвращает ссылку целиком, включая блок digitalGood, которого нет в результатах поиска.',
    schema: { id: z.string().describe('UUID платёжной ссылки') },
    handler: (a) => acq().json(`/api/h2h/links/${pathSegment(a.id as string)}`),
  },
  {
    name: 'wata_acq_transactions_find',
    title: 'Поиск транзакций (публичный API)',
    description:
      'Ищет транзакции терминала. Пагинация КУРСОРНАЯ: для следующей страницы передайте ' +
      'cursorId и cursorAmount из полей nextCursorId и nextCursorAmount предыдущего ответа.',
    schema: {
      orderId: z.string().optional(),
      creationTimeFrom: z.string().optional().describe('ISO 8601'),
      creationTimeTo: z.string().optional().describe('ISO 8601'),
      amountFrom: z.number().optional(),
      amountTo: z.number().optional(),
      currencies: z.array(z.enum(CURRENCIES)).optional(),
      statuses: z.array(z.enum(TX_STATUSES)).optional(),
      paymentLinkIds: z.array(z.string()).optional().describe('Фильтр по платёжным ссылкам'),
      sorting: z.string().optional().describe('amount или creationTime, суффикс desc'),
      cursorId: z.string().optional().describe('nextCursorId из предыдущего ответа'),
      cursorAmount: z.number().optional().describe('nextCursorAmount из предыдущего ответа'),
      cursorDate: z.string().optional().describe('nextCursorDate из предыдущего ответа'),
      maxResultCount: z.number().int().min(1).max(1000).optional().describe('По умолчанию 10'),
    },
    handler: (a) =>
      acq().json('/api/h2h/v2/transactions', {
        query: {
          OrderId: a.orderId,
          CreationTimeFrom: a.creationTimeFrom,
          CreationTimeTo: a.creationTimeTo,
          AmountFrom: a.amountFrom,
          AmountTo: a.amountTo,
          Currencies: a.currencies,
          Statuses: a.statuses,
          PaymentLinkIds: a.paymentLinkIds,
          Sorting: a.sorting,
          CursorId: a.cursorId,
          CursorAmount: a.cursorAmount,
          CursorDate: a.cursorDate,
          MaxResultCount: a.maxResultCount ?? 10,
        },
      }),
  },
  {
    name: 'wata_acq_transaction_get',
    title: 'Транзакция по идентификатору (публичный API)',
    description:
      'Карточка транзакции. Учтите расхождение с вебхуком: здесь комиссия называется ' +
      'totalCommission, а в payload вебхука то же значение приходит как commission.',
    schema: { id: z.string().describe('UUID транзакции') },
    handler: (a) => acq().json(`/api/h2h/transactions/${pathSegment(a.id as string)}`),
  },
  {
    name: 'wata_acq_refund_create',
    title: 'Возврат через публичный API',
    description:
      'НЕОБРАТИМАЯ ДЕНЕЖНАЯ ОПЕРАЦИЯ. Нужны только два поля: идентификатор исходной транзакции ' +
      'и сумма — валюта берётся из исходной транзакции. Сумма должна быть больше нуля, ' +
      'не превышать доступный остаток и содержать не более двух знаков после запятой. ' +
      'Возврат недоступен на терминалах с продуктом «Цифровые товары + Эквайринг».',
    mutating: true,
    schema: {
      originalTransactionId: z.string().describe('UUID оплаченной транзакции'),
      amount: z.number().positive().describe('Сумма возврата'),
      confirm: z
        .literal(true)
        .describe(
          'Подтверждение возврата. Передайте true только после того, как проверили ' +
            'транзакцию и сумму: отменить возврат невозможно',
        ),
    },
    handler: (a) => {
      if (a.confirm !== true) throw new Error('Возврат не подтверждён: передайте confirm: true');
      return acq().json('/api/h2h/transactions/refunds', {
        method: 'POST',
        body: { originalTransactionId: a.originalTransactionId, amount: a.amount },
      });
    },
  },
  {
    name: 'wata_acq_balance',
    title: 'Баланс терминала',
    description:
      'Баланс терминала на дату. Дата обязательна и может быть ТОЛЬКО сегодняшней или вчерашней ' +
      'по UTC — другие значения сервер отвергает. За более ранние периоды берите отчёты кабинета ' +
      '(wata_finance_daily).',
    schema: { date: z.string().describe('Дата YYYY-MM-DD: сегодня или вчера по UTC') },
    handler: (a) => acq().json('/api/h2h/finance/balance', { query: { Date: a.date } }),
  },
  {
    name: 'wata_acq_pay_sbp',
    title: 'Прямая оплата через СБП',
    description:
      'Создаёт платёж по СБП и возвращает sbpLink для перенаправления плательщика. ' +
      'Только рубли — поля валюты у этого метода нет. Требуется прямая интеграция H2H.',
    mutating: true,
    schema: {
      amount: z.number().positive().describe('Сумма в рублях'),
      ip: z.string().describe('IP-адрес плательщика'),
      returnUrl: z.string().describe('Куда вернуть плательщика после оплаты'),
      deviceData: z.record(z.unknown()).describe('Данные устройства плательщика'),
      orderId: z.string().optional(),
      description: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    },
    handler: (a) => acq().json('/api/h2h/payments/sbp', { method: 'POST', body: stripUndefined(a) }),
  },
  {
    name: 'wata_acq_pay_tpay',
    title: 'Прямая оплата через T-Pay',
    description:
      'Создаёт платёж через T-Pay и возвращает tPayLink. Только рубли, поля валюты нет.',
    mutating: true,
    schema: {
      amount: z.number().positive().describe('Сумма в рублях'),
      ip: z.string().describe('IP-адрес плательщика'),
      returnUrl: z.string().describe('Куда вернуть плательщика после оплаты'),
      deviceData: z.record(z.unknown()).describe('Данные устройства плательщика'),
      orderId: z.string().optional(),
      description: z.string().optional(),
      email: z.string().optional(),
    },
    handler: (a) =>
      acq().json('/api/h2h/payments/tpay', { method: 'POST', body: stripUndefined(a) }),
  },
  {
    name: 'wata_acq_pay_card',
    title: 'Прямая оплата картой',
    description:
      'Оплата картой по криптограмме. Криптограмму НЕЛЬЗЯ собрать на сервере: её формирует ' +
      'клиентский скрипт чекаута WATA в браузере плательщика, а вы лишь передаёте полученную строку. ' +
      'Если у вас нет готовой криптограммы, используйте платёжную ссылку (wata_acq_link_create).',
    mutating: true,
    schema: {
      amount: z.number().positive(),
      currency: z.enum(CURRENCIES),
      cardCrypto: z.string().describe('Криптограмма из клиентского скрипта чекаута'),
      ip: z.string().describe('IP-адрес плательщика'),
      returnUrl: z.string().optional(),
      deviceData: z.record(z.unknown()).optional(),
      orderId: z.string().optional(),
      description: z.string().optional(),
      email: z.string().optional(),
    },
    handler: (a) =>
      acq().json('/api/h2h/payments/card-crypto', { method: 'POST', body: stripUndefined(a) }),
  },
];

/** Публичный API не любит явные null в необязательных полях. */
function stripUndefined(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}
