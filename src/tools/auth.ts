import { z } from 'zod';
import type { ToolDef } from './registry.js';

export const authTools: ToolDef[] = [
  {
    name: 'wata_auth_status',
    title: 'Статус сессии WATA',
    description:
      'Проверяет, есть ли действующая сессия личного кабинета, и показывает данные текущего пользователя.',
    schema: {},
    handler: async (_args, { session }) => {
      if (!session.isAuthenticated()) {
        return { authenticated: false, hint: 'Выполните wata_auth_login' };
      }
      try {
        const profile = await session.http.json('/api/my-profile');
        return { authenticated: true, profile };
      } catch (e) {
        return { authenticated: false, error: (e as Error).message };
      }
    },
  },
  {
    name: 'wata_auth_login',
    title: 'Вход в кабинет (шаг 1)',
    description:
      'Отправляет email и пароль. Кабинет всегда требует второй фактор: код придёт на почту, ' +
      'после чего нужно вызвать wata_auth_verify. ' +
      'ПРЕДПОЧТИТЕЛЬНО вызывать БЕЗ аргументов: тогда почта и пароль берутся из переменных ' +
      'окружения WATA_EMAIL и WATA_PASSWORD и никуда не записываются. ' +
      'Аргументы этого инструмента попадают в историю диалога клиента в открытом виде, ' +
      'поэтому передавать пароль напрямую стоит только если другого способа нет.',
    mutating: true,
    schema: {
      email: z
        .string()
        .email()
        .optional()
        .describe('Почта. Лучше не передавать — задайте WATA_EMAIL'),
      password: z
        .string()
        .optional()
        .describe(
          'Пароль. Лучше не передавать: значение осядет в истории диалога. Задайте WATA_PASSWORD',
        ),
    },
    handler: async (args, { session }) => {
      const email = (args.email as string) ?? process.env.WATA_EMAIL;
      const password = (args.password as string) ?? process.env.WATA_PASSWORD;
      if (!email || !password) {
        throw new Error('Нужны email и пароль (аргументами или через WATA_EMAIL/WATA_PASSWORD)');
      }
      return session.login(email, password);
    },
  },
  {
    name: 'wata_auth_verify',
    title: 'Подтверждение входа кодом (шаг 2)',
    description:
      'Завершает вход, принимая код из письма. После успеха сессия сохраняется локально и живёт ' +
      'около 60 дней. Код одноразовый и живёт несколько минут: вызывайте сразу после получения. ' +
      'Неудачная попытка гасит запрос второго фактора — тогда начинайте вход заново. ' +
      'Учтите, что код попадёт в историю диалога; после входа он уже бесполезен, ' +
      'но саму историю стоит считать содержащей чувствительные данные.',
    mutating: true,
    schema: { code: z.string().min(4).describe('Код из письма, действует несколько минут') },
    handler: async (args, { session }) => {
      await session.verifyTwoFactor(args.code as string);
      const profile = await session.http.json('/api/my-profile');
      return { authenticated: true, profile };
    },
  },
  {
    name: 'wata_auth_logout',
    title: 'Выход из кабинета',
    description: 'Завершает сессию на сервере и очищает локально сохранённые куки.',
    mutating: true,
    schema: {},
    handler: async (_args, { session }) => {
      await session.logout();
      return { ok: true };
    },
  },
];
