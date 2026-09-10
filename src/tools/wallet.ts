import { pathSegment } from '../core/url.js';
import { z } from 'zod';
import type { ToolDef } from './registry.js';

/**
 * Кошелёк: балансы, курсы, вывод средств и автосеттлмент.
 *
 * Вывод средств — трёхшаговый, и порядок шагов обязателен:
 *   1. calculate-commission -> возвращает orderId и quoteId
 *   2. initiate            -> создаёт заявку, возвращает credentialTokenId
 *   3. confirm             -> код подтверждения, ПОСЛЕ ЭТОГО деньги уходят
 * Инструменты намеренно повторяют эту последовательность, а не прячут её:
 * агент не должен иметь возможности вывести деньги одним неосторожным вызовом.
 */

export const walletTools: ToolDef[] = [
  {
    name: 'wata_wallet_rates',
    title: 'Рыночные курсы',
    description: 'Актуальные курсы конвертации, используемые кошельком.',
    schema: {},
    handler: (_a, { session }) => session.http.json('/api/wallet/client/market/rates'),
  },
  {
    name: 'wata_wallet_operation_get',
    title: 'Детали операции кошелька',
    description: 'Карточка одной операции по идентификатору.',
    schema: { id: z.string().describe('Идентификатор операции') },
    handler: (a, { session }) =>
      session.http.json(`/api/wallet/client/operations/${pathSegment(a.id as string)}`),
  },
  {
    name: 'wata_wallet_withdrawal_limits',
    title: 'Лимиты вывода',
    description:
      'Лимиты вывода. Параметры обязательны: для фиата — currency и method, для крипты — ' +
      'currency и blockchainType. Без них сервер отвечает «Ваш запрос недействителен».',
    schema: {
      kind: z.enum(['fiat', 'crypto']).describe('Тип вывода'),
      currency: z.string().describe('Валюта: RUB для фиата, USDT для крипты'),
      method: z.enum(['SBP', 'Card']).optional().describe('Способ вывода, только для fiat'),
      blockchainType: z.string().optional().describe('Сеть, только для crypto; обычно Tron'),
    },
    handler: (a, { session }) => {
      const isCrypto = a.kind === 'crypto';
      return session.http.json(`/api/wallet/client/${pathSegment(a.kind as string)}/withdrawals/limits`, {
        query: isCrypto
          ? { Currency: a.currency, BlockchainType: a.blockchainType ?? 'Tron' }
          : { Currency: a.currency, Method: a.method ?? 'SBP' },
      });
    },
  },
  {
    name: 'wata_wallet_withdrawal_terminal_info',
    title: 'Данные терминала для вывода',
    description: 'Информация о терминале, через который проходит фиатный вывод.',
    schema: { query: z.record(z.unknown()).optional().describe('Параметры запроса') },
    handler: (a, { session }) =>
      session.http.json('/api/wallet/client/fiat/withdrawals/terminal-info', {
        query: a.query as Record<string, unknown> | undefined,
      }),
  },
  {
    name: 'wata_wallet_withdrawal_commission',
    title: 'Расчёт комиссии вывода (шаг 1)',
    description:
      'Считает комиссию и возвращает orderId и quoteId, без которых нельзя создать заявку. ' +
      'Ничего не списывает — безопасный способ узнать итоговую сумму заранее.',
    schema: {
      kind: z.enum(['fiat', 'crypto']).describe('Тип вывода'),
      amount: z.number().positive().describe('Сумма вывода'),
      currency: z.string().describe('Валюта: RUB или USDT'),
      method: z.enum(['SBP', 'Card']).optional().describe('Способ вывода, только для fiat'),
      fromAccountId: z.string().optional().describe('Счёт списания; обычно не требуется'),
    },
    handler: (a, { session }) =>
      session.http.json(`/api/wallet/client/${pathSegment(a.kind as string)}/withdrawals/calculate-commission`, {
        method: 'POST',
        body: {
          amount: a.amount,
          currency: a.currency,
          method: a.method,
          fromAccountId: a.fromAccountId ?? null,
        },
      }),
  },
  {
    name: 'wata_wallet_withdraw_initiate',
    title: 'Создать заявку на вывод (шаг 2)',
    description:
      'ДЕНЕЖНАЯ ОПЕРАЦИЯ. Создаёт заявку на вывод; деньги ещё не уходят. ' +
      'Сначала вызовите wata_wallet_withdrawal_commission — оттуда берутся orderId и quoteId. ' +
      'В ответе придёт credentialTokenId, он нужен для подтверждения. ' +
      'Для СБП нужны bankNumber (из wata_wallet_banks) и телефон получателя из 11 цифр, начиная с 7. ' +
      'Вывод НА КАРТУ через API невозможен: номер карты вводится только в защищённом виджете кабинета.',
    mutating: true,
    schema: {
      method: z.enum(['sbp', 'crypto']).describe('Способ вывода'),
      orderId: z.string().describe('orderId из расчёта комиссии'),
      quoteId: z.string().optional().describe('quoteId из расчёта комиссии, для фиата'),
      bankNumber: z.string().optional().describe('Код банка из wata_wallet_banks, для СБП'),
      phone: z.string().optional().describe('Телефон получателя, 11 цифр начиная с 7, для СБП'),
      amount: z.number().positive().optional().describe('Сумма, для крипты'),
      currency: z.string().optional().describe('Валюта, для крипты обычно USDT'),
      blockchainType: z.string().optional().describe('Сеть, для крипты обычно Tron'),
      commission: z.number().optional().describe('Комиссия из расчёта, для крипты'),
      address: z.string().optional().describe('Адрес кошелька получателя, для крипты'),
    },
    handler: (a, { session }) => {
      if (a.method === 'crypto') {
        return session.http.json('/api/wallet/client/crypto/withdrawals/initiate', {
          method: 'POST',
          body: {
            amount: a.amount,
            currency: a.currency ?? 'USDT',
            blockchainType: a.blockchainType ?? 'Tron',
            commission: a.commission,
            address: a.address,
            orderId: a.orderId,
          },
        });
      }
      return session.http.json('/api/wallet/client/fiat/withdrawals/initiate/sbp', {
        method: 'POST',
        body: {
          bankNumber: a.bankNumber,
          phone: a.phone,
          orderId: a.orderId,
          quoteId: a.quoteId,
        },
      });
    },
  },
  {
    name: 'wata_wallet_withdraw_confirm',
    title: 'Подтвердить вывод (шаг 3)',
    description:
      'ДЕНЕЖНАЯ ОПЕРАЦИЯ, НЕОБРАТИМАЯ. После этого вызова средства уходят. ' +
      'Нужны код подтверждения и credentialTokenId из заявки. ' +
      'Для фиата дополнительно передаётся orderId, для крипты — нет.',
    mutating: true,
    schema: {
      kind: z.enum(['fiat', 'crypto']).describe('Тип вывода, как в заявке'),
      code: z.string().describe('Код подтверждения'),
      credentialTokenId: z.string().describe('credentialTokenId из ответа на создание заявки'),
      orderId: z.string().optional().describe('orderId — обязателен для фиата'),
    },
    handler: (a, { session }) => {
      const isCrypto = a.kind === 'crypto';
      return session.http.json(`/api/wallet/client/${pathSegment(a.kind as string)}/withdrawals/confirm`, {
        method: 'POST',
        body: isCrypto
          ? { code: a.code, credentialTokenId: a.credentialTokenId }
          : { code: a.code, credentialTokenId: a.credentialTokenId, orderId: a.orderId },
      });
    },
  },
  {
    name: 'wata_wallet_fiat_order_get',
    title: 'Статус заявки на фиатный вывод',
    description: 'Текущее состояние ранее созданной заявки.',
    schema: { orderId: z.string().describe('Идентификатор заявки') },
    handler: (a, { session }) =>
      session.http.json(`/api/wallet/client/fiat/orders/${pathSegment(a.orderId as string)}`),
  },
  {
    name: 'wata_wallet_crypto_deposit',
    title: 'Адрес криптовалютного пополнения',
    description: 'Запрашивает реквизиты для пополнения кошелька в криптовалюте.',
    mutating: true,
    schema: {
      currency: z.string().optional().describe('Валюта, обычно USDT'),
      blockchainType: z.string().optional().describe('Сеть, обычно Tron'),
    },
    handler: (a, { session }) =>
      session.http.json('/api/wallet/client/crypto/deposit', {
        method: 'POST',
        body: { currency: a.currency ?? 'USDT', blockchainType: a.blockchainType ?? 'Tron' },
      }),
  },
  {
    name: 'wata_wallet_transfer',
    title: 'Перевод между счетами',
    description: 'ДЕНЕЖНАЯ ОПЕРАЦИЯ. Переводит средства между счетами кошелька.',
    mutating: true,
    schema: {
      amount: z.number().positive().describe('Сумма перевода'),
      currency: z.string().describe('Валюта, например USDT'),
      fromAccountId: z.string().describe('Счёт списания из wata_wallet_balances'),
      toAccountId: z.string().describe('Счёт зачисления из wata_wallet_balances'),
    },
    handler: (a, { session }) =>
      session.http.json('/api/wallet/client/accounts/transfer', {
        method: 'POST',
        body: {
          amount: a.amount,
          currency: a.currency,
          fromAccountId: a.fromAccountId,
          toAccountId: a.toAccountId,
        },
      }),
  },
  {
    name: 'wata_wallet_autosettlement_get',
    title: 'Настройки автосеттлмента',
    description: 'Текущие правила автоматического вывода выручки.',
    schema: {},
    handler: (_a, { session }) => session.http.json('/api/wallet/client/autosettlement'),
  },
  {
    name: 'wata_wallet_autosettlement_initiate',
    title: 'Изменить автосеттлмент (шаг 1)',
    description:
      'Создаёт запрос на изменение правил автоматического вывода. Требует подтверждения кодом. ' +
      'balancePercentage — какая доля баланса выводится, minimumThreshold — порог срабатывания.',
    mutating: true,
    schema: {
      balancePercentage: z.number().min(0).max(100).describe('Процент баланса для автовывода'),
      minimumThreshold: z.number().min(0).describe('Минимальный порог срабатывания'),
      currency: z.string().optional().describe('Валюта, обычно USDT'),
      blockchainType: z.string().optional().describe('Сеть, обычно Tron'),
      address: z.string().optional().describe('Адрес получателя'),
    },
    handler: (a, { session }) =>
      session.http.json('/api/wallet/client/autosettlement/initiate', {
        method: 'POST',
        body: {
          balancePercentage: a.balancePercentage,
          minimumThreshold: a.minimumThreshold,
          currency: a.currency ?? 'USDT',
          blockchainType: a.blockchainType ?? 'Tron',
          address: a.address,
        },
      }),
  },
  {
    name: 'wata_wallet_autosettlement_confirm',
    title: 'Подтвердить автосеттлмент (шаг 2)',
    description: 'Подтверждает изменение правил автоматического вывода средств.',
    mutating: true,
    schema: {
      code: z.string().describe('Код подтверждения'),
      credentialTokenId: z.string().describe('credentialTokenId из ответа на шаг 1'),
    },
    handler: (a, { session }) =>
      session.http.json('/api/wallet/client/autosettlement/confirm', {
        method: 'POST',
        body: { code: a.code, credentialTokenId: a.credentialTokenId },
      }),
  },
];
