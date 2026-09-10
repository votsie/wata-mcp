import { pathSegment } from '../core/url.js';
import { z } from 'zod';
import { pagingQuery, pagingShape, periodQuery, periodShape, type ToolDef } from './registry.js';

/** Поддержка и цифровые товары. */
export const supportTools: ToolDef[] = [
  {
    name: 'wata_support_ticket_get',
    title: 'Детали тикета',
    description: 'Обращение в поддержку целиком, включая переписку.',
    schema: { id: z.string().describe('Идентификатор тикета') },
    handler: (a, { session }) => session.http.json(`/api/tickets/merchant/${pathSegment(a.id as string)}`),
  },
  {
    name: 'wata_support_ticket_create',
    title: 'Создать обращение в поддержку',
    description:
      'Открывает новое обращение в поддержку WATA. Категория определяет маршрут обращения ' +
      'внутри WATA — например, MissingTransaction для недошедшего платежа. ' +
      'Указывайте в тексте идентификаторы транзакции и терминала: так обращение решается быстрее.',
    mutating: true,
    schema: {
      category: z.string().describe('Категория обращения, например MissingTransaction'),
      description: z.string().describe('Текст обращения'),
      subject: z.string().optional().describe('Тема обращения'),
    },
    handler: (a, { session }) => {
      const payload: Record<string, unknown> = {
        category: a.category,
        description: a.description,
      };
      if (a.subject !== undefined) payload.subject = a.subject;

      const { body, contentType } = buildMultipart(payload);
      return session.http.json('/api/tickets/merchant', { method: 'POST', body, contentType });
    },
  },
  {
    name: 'wata_support_ticket_reply',
    title: 'Ответить в тикет',
    description:
      'Добавляет комментарий в обращение поддержки от имени мерчанта. ' +
      'Кабинет принимает этот запрос как multipart/form-data, а не как JSON — ' +
      'инструмент собирает нужную форму сам.',
    mutating: true,
    schema: {
      id: z.string().describe('Идентификатор тикета'),
      text: z.string().describe('Текст комментария'),
    },
    handler: (a, { session }) => {
      const { body, contentType } = buildMultipart({ text: a.text as string });
      return session.http.json(`/api/tickets/merchant/${pathSegment(a.id as string)}/comments`, {
        method: 'POST',
        body,
        contentType,
      });
    },
  },
  {
    name: 'wata_support_comment_mark_read',
    title: 'Отметить комментарий прочитанным',
    description: 'Снимает отметку о непрочитанном ответе поддержки.',
    mutating: true,
    schema: {
      id: z.string().describe('Идентификатор тикета'),
      commentId: z.string().describe('Идентификатор комментария'),
    },
    handler: (a, { session }) =>
      session.http.json(
        `/api/tickets/merchant/${pathSegment(a.id as string)}/comments/${pathSegment(a.commentId as string)}/read`,
        { method: 'POST' },
      ),
  },
  {
    name: 'wata_digital_goods_order_statuses',
    title: 'Счётчики заказов цифровых товаров',
    description: 'Количество заказов digital goods в разрезе статусов.',
    schema: periodShape,
    handler: (a, { session }) =>
      session.http.json('/api/digital-goods/merchant/orders/statuses', { query: periodQuery(a) }),
  },
  {
    name: 'wata_digital_goods_order_get',
    title: 'Детали заказа цифровых товаров',
    description: 'Карточка заказа digital goods по терминалу и идентификатору заказа.',
    schema: {
      publicId: z.string().describe('publicId терминала'),
      orderId: z.string().describe('Идентификатор заказа'),
    },
    handler: (a, { session }) =>
      session.http.json(
        `/api/digital-goods/merchant/orders/terminals/${pathSegment(a.publicId as string)}/orders/${pathSegment(a.orderId as string)}`,
      ),
  },
  {
    name: 'wata_stories_disable',
    title: 'Отключить обучающие истории',
    description: 'Выключает баннеры-истории в интерфейсе кабинета.',
    mutating: true,
    schema: {},
    handler: (_a, { session }) =>
      session.http.json('/api/merchant/merchants/stories/disable', { method: 'PUT' }),
  },
  {
    name: 'wata_password_reset_request',
    title: 'Запросить код смены пароля',
    description: 'Отправляет на почту код для восстановления пароля.',
    mutating: true,
    schema: { email: z.string().email().describe('Почта аккаунта') },
    handler: (a, { session }) =>
      session.http.json('/api/accounts/send-password-reset-code', {
        method: 'POST',
        body: { email: a.email },
      }),
  },
  {
    name: 'wata_password_reset_confirm',
    title: 'Сменить пароль по коду',
    description: 'Устанавливает новый пароль, используя код из письма.',
    mutating: true,
    schema: { payload: z.record(z.unknown()).describe('Почта, код и новый пароль') },
    handler: (a, { session }) =>
      session.http.json('/api/accounts/reset-password', { method: 'POST', body: a.payload }),
  },
  {
    name: 'wata_admin_subscriptions',
    title: 'Подписки (административный обзор)',
    description: 'Расширенный список подписок, доступный из административного раздела кабинета.',
    schema: pagingShape,
    handler: (a, { session }) =>
      session.http.json('/api/admin/subscriptions', { query: pagingQuery(a) }),
  },
];

/**
 * Собирает multipart/form-data так, как его ждёт кабинет: одно поле `data`
 * с JSON-строкой внутри. Граница фиксированная, потому что Math.random()
 * не нужен — тело каждый раз короткое и текстовое, коллизия исключена
 * проверкой ниже.
 */
function buildMultipart(payload: Record<string, unknown>): { body: string; contentType: string } {
  const json = JSON.stringify(payload);

  let boundary = '----WataMcpFormBoundary';
  // Граница обязана не встречаться в теле, иначе форма разъедется.
  while (json.includes(boundary)) boundary += 'x';

  const body =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="data"\r\n\r\n' +
    `${json}\r\n` +
    `--${boundary}--\r\n`;

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
