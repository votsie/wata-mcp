import { z } from 'zod';
import { pagingQuery, pagingShape, periodQuery, periodShape, type ToolDef } from './registry.js';
import { assertApiPath, pathSegment } from '../core/url.js';
import { merchantOrigin } from '../core/http.js';

/**
 * Инструменты личного кабинета.
 *
 * Кабинет использует две несовместимые схемы пагинации:
 *  - offset:  {totalCount, items}                              — терминалы, ссылки, выплаты, тикеты
 *  - курсор:  {hasNextPage, nextCursorId, nextCursorDate, items} — транзакции, чарджбеки
 * Поэтому у курсорных инструментов параметры отличаются от pagingShape.
 */

const cursorShape = {
  cursorId: z.string().optional().describe('nextCursorId из предыдущего ответа'),
  cursorDate: z.string().optional().describe('nextCursorDate из предыдущего ответа'),
  maxResultCount: z.number().int().min(1).max(1000).optional().describe('Размер страницы'),
} satisfies z.ZodRawShape;

function cursorQuery(args: Record<string, unknown>): Record<string, unknown> {
  return {
    CursorId: args.cursorId,
    CursorDate: args.cursorDate,
    MaxResultCount: args.maxResultCount ?? 20,
  };
}

export const lkTools: ToolDef[] = [
  // ---------------------------------------------------------------- профиль
  {
    name: 'wata_profile_get',
    title: 'Профиль пользователя',
    description: 'Имя, почта, телефон, telegram, роли и идентификатор текущего пользователя.',
    schema: {},
    handler: (_a, { session }) => session.http.json('/api/my-profile'),
  },
  {
    name: 'wata_merchant_get',
    title: 'Карточка мерчанта',
    description:
      'Данные организации-мерчанта: название, статус, закреплённые менеджеры, даты создания и изменения.',
    schema: {},
    handler: (_a, { session }) => session.http.json('/api/merchant/merchants/my-merchant'),
  },

  // -------------------------------------------------------------- терминалы
  {
    name: 'wata_terminals_list',
    title: 'Список терминалов',
    description:
      'Терминалы мерчанта с оборотом, выручкой, ставками WATA, типом продукта и доступными методами оплаты. ' +
      'Период From/To влияет на суммы оборота и выручки.',
    schema: { ...pagingShape, ...periodShape },
    handler: (a, { session }) =>
      session.http.json('/api/merchant/terminals', {
        query: { ...pagingQuery({ ...a, maxResultCount: a.maxResultCount ?? 100 }), ...periodQuery(a) },
      }),
  },
  {
    name: 'wata_terminal_get',
    title: 'Детали терминала',
    description:
      'Полная карточка терминала, включая адрес вебхука, страницы успеха и ошибки, разрешённые домены.',
    schema: { id: z.string().describe('Идентификатор терминала (поле id, не publicId)') },
    handler: (a, { session }) => session.http.json(`/api/merchant/terminals/${pathSegment(a.id as string)}`),
  },
  {
    name: 'wata_terminals_finance',
    title: 'Финансы по терминалам',
    description: 'Балансы терминалов и статус готовности к конвертации/выплате.',
    schema: { ...pagingShape, ...periodShape },
    handler: (a, { session }) =>
      session.http.json('/api/payout/merchant/terminals', {
        query: { ...pagingQuery({ ...a, maxResultCount: a.maxResultCount ?? 100 }), ...periodQuery(a) },
      }),
  },

  // ------------------------------------------------------------- транзакции
  {
    name: 'wata_transactions_list',
    title: 'Список транзакций',
    description:
      'Транзакции мерчанта с курсорной пагинацией. Для следующей страницы передайте nextCursorId и nextCursorDate из предыдущего ответа.',
    schema: {
      ...cursorShape,
      ...periodShape,
      status: z.string().optional().describe('Фильтр по статусу, например Paid, Pending, Declined'),
      terminalId: z.string().optional().describe('Фильтр по терминалу'),
      search: z.string().optional().describe('Поисковая строка'),
    },
    handler: (a, { session }) =>
      session.http.json('/api/merchant/transactions', {
        query: {
          ...cursorQuery(a),
          ...periodQuery(a),
          Status: a.status,
          TerminalId: a.terminalId,
          Search: a.search,
        },
      }),
  },
  {
    name: 'wata_transactions_counts',
    title: 'Счётчики транзакций по статусам',
    description: 'Количество транзакций в разрезе статусов: created, paid, pending, declined.',
    schema: periodShape,
    handler: (a, { session }) =>
      session.http.json('/api/merchant/transactions/statuses', { query: periodQuery(a) }),
  },

  // ----------------------------------------------------------------- ссылки
  {
    name: 'wata_links_list',
    title: 'Платёжные ссылки',
    description: 'Созданные платёжные ссылки мерчанта.',
    schema: { ...pagingShape, ...periodShape },
    handler: (a, { session }) =>
      session.http.json('/api/merchant/links', {
        query: { ...pagingQuery(a), ...periodQuery(a) },
      }),
  },

  // ------------------------------------------------------------- чарджбеки
  {
    name: 'wata_chargebacks_list',
    title: 'Чарджбеки',
    description: 'Список чарджбеков с курсорной пагинацией.',
    schema: { ...cursorShape, ...periodShape },
    handler: (a, { session }) =>
      session.http.json('/api/merchant/chargebacks', {
        query: { ...cursorQuery(a), ...periodQuery(a) },
      }),
  },

  // ------------------------------------------------------------- подписки
  {
    name: 'wata_subscriptions_list',
    title: 'Подписки',
    description: 'Регулярные списания (подписки) мерчанта.',
    schema: pagingShape,
    handler: (a, { session }) =>
      session.http.json('/api/merchant/subscriptions', {
        query: pagingQuery({ ...a, maxResultCount: a.maxResultCount ?? 100 }),
      }),
  },
  {
    name: 'wata_subscriptions_counts',
    title: 'Счётчики подписок',
    description: 'Количество подписок по статусам: active, completed, failed.',
    schema: {},
    handler: (_a, { session }) => session.http.json('/api/merchant/subscriptions/statuses'),
  },

  // ------------------------------------------------------------- финансы
  {
    name: 'wata_finance_summary',
    title: 'Оборот и выручка за период',
    description: 'Суммарный оборот и выручка мерчанта за период, по валютам.',
    schema: periodShape,
    handler: (a, { session }) =>
      session.http.json('/api/merchant/finance/turnover-and-revenue/total', { query: periodQuery(a) }),
  },
  {
    name: 'wata_finance_daily',
    title: 'Оборот и выручка по дням',
    description: 'Разбивка оборота и выручки по дням — основа для графиков и сверки.',
    schema: periodShape,
    handler: (a, { session }) =>
      session.http.json('/api/merchant/finance/turnover-and-revenue/daily', { query: periodQuery(a) }),
  },
  {
    name: 'wata_payouts_history',
    title: 'История выплат',
    description: 'Выплаты мерчанту: сумма, статус, дата, задействованные терминалы.',
    schema: { ...pagingShape, ...periodShape },
    handler: (a, { session }) =>
      session.http.json('/api/payout/merchant/payouts/history', {
        query: { ...pagingQuery(a), ...periodQuery(a) },
      }),
  },
  {
    name: 'wata_converts_history',
    title: 'История конвертаций',
    description: 'Конвертации выручки терминалов, включая курс и итоговую сумму.',
    schema: { ...pagingShape, ...periodShape },
    handler: (a, { session }) =>
      session.http.json('/api/payout/merchant/convert/history', {
        query: { ...pagingQuery(a), ...periodQuery(a) },
      }),
  },

  // -------------------------------------------------------------- кошелёк
  {
    name: 'wata_wallet_balances',
    title: 'Балансы кошелька',
    description:
      'Счета кошелька и остатки по валютам (в том числе USDT), с точностью каждой валюты.',
    schema: {},
    handler: (_a, { session }) => session.http.json('/api/wallet/client/accounts/balances'),
  },
  {
    name: 'wata_wallet_operations',
    title: 'Операции по кошельку',
    description:
      'История операций кошелька. accountId берётся из wata_wallet_balances.',
    schema: {
      accountId: z.string().describe('Идентификатор счёта из wata_wallet_balances'),
      ...pagingShape,
      ...periodShape,
    },
    handler: (a, { session }) =>
      session.http.json('/api/wallet/client/operations', {
        query: {
          AccountId: a.accountId,
          'CreatedAtPeriod.From': a.from,
          'CreatedAtPeriod.To': a.to,
          ...pagingQuery(a),
        },
      }),
  },
  {
    name: 'wata_wallet_withdrawal_methods',
    title: 'Методы вывода',
    description: 'Доступные способы фиатного вывода средств и привязанные к ним терминалы.',
    schema: {},
    handler: (_a, { session }) => session.http.json('/api/wallet/client/fiat/withdrawals/methods'),
  },
  {
    name: 'wata_wallet_banks',
    title: 'Справочник банков',
    description: 'Банки, доступные для фиатного вывода, с их номерами для СБП.',
    schema: {},
    handler: (_a, { session }) => session.http.json('/api/wallet/client/fiat/withdrawals/banks'),
  },

  // ------------------------------------------------------ цифровые товары
  {
    name: 'wata_digital_goods_orders',
    title: 'Заказы цифровых товаров',
    description: 'Заказы направления digital goods: Steam, Telegram Stars, пополнения, ваучеры.',
    schema: { ...pagingShape, ...periodShape },
    handler: (a, { session }) =>
      session.http.json('/api/digital-goods/merchant/orders', {
        query: { ...pagingQuery(a), ...periodQuery(a) },
      }),
  },

  // ------------------------------------------------------------ поддержка
  {
    name: 'wata_support_tickets',
    title: 'Тикеты поддержки',
    description: 'Обращения в поддержку: тема, категория, статус, наличие непрочитанных ответов.',
    schema: pagingShape,
    handler: (a, { session }) =>
      session.http.json('/api/tickets/merchant', { query: pagingQuery(a) }),
  },

  // ---------------------------------------------------------- аварийный люк
  {
    name: 'wata_raw_request',
    title: 'Произвольный запрос к кабинету',
    description:
      'Выполняет любой запрос к API личного кабинета с текущей сессией, antiforgery-токеном и защитой от DDoS-Guard. ' +
      'Нужен для того, что ещё не покрыто типизированными инструментами. Путь должен начинаться с /api/. ' +
      'Осторожно: метод, отличный от GET, изменяет данные аккаунта.',
    mutating: true,
    schema: {
      path: z.string().describe('Путь, например /api/merchant/terminals'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
        .optional()
        .describe('По умолчанию GET'),
      query: z.record(z.unknown()).optional().describe('Параметры строки запроса'),
      body: z.unknown().optional().describe('Тело запроса в виде JSON'),
    },
    handler: (a, { session }) => {
      // Проверяем путь после нормализации URL: строковая проверка обходится сегментами "..".
      const path = assertApiPath(a.path as string, merchantOrigin());
      return session.http.json(path, {
        method: (a.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined) ?? 'GET',
        query: a.query as Record<string, unknown> | undefined,
        body: a.body,
      });
    },
  },
];
