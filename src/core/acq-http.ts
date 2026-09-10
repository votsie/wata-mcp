import { request } from 'undici';
import { RateLimiter, backoffDelay, sleep, USER_AGENT } from './antiddos.js';
import { WataHttpError } from './http.js';

export const ACQ_BASE_URL = 'https://api.wata.pro';
export const ACQ_SANDBOX_URL = 'https://api-sandbox.wata.pro';
export const DG_BASE_URL = 'https://dg-api.wata.pro';

/**
 * У WATA два независимых окружения со СВОИМИ токенами и, что важнее, со своими
 * публичными ключами для проверки подписи вебхуков. Смешивать их нельзя.
 */
export function acqBaseUrl(): string {
  return process.env.WATA_ENV === 'sandbox' ? ACQ_SANDBOX_URL : ACQ_BASE_URL;
}

/**
 * Клиент публичного API WATA (эквайринг и цифровые товары).
 *
 * Отличается от клиента кабинета принципиально: здесь нет ни сессии, ни
 * antiforgery, ни DDoS-Guard — только JWT в заголовке Authorization.
 * Важно помнить, что этот токен выпускается НА ТЕРМИНАЛ и не даёт доступа
 * к аккаунту целиком; всё управление аккаунтом идёт через клиент кабинета.
 */
export class WataAcqHttp {
  private readonly limiter = new RateLimiter(
    Number(process.env.WATA_MIN_REQUEST_INTERVAL_MS ?? 200),
  );
  private readonly maxRetries = Number(process.env.WATA_MAX_RETRIES ?? 3);

  constructor(
    private readonly token: string | undefined = process.env.WATA_ACQ_TOKEN,
    private readonly baseUrl: string = acqBaseUrl(),
  ) {}

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  withBase(baseUrl: string): WataAcqHttp {
    return new WataAcqHttp(this.token, baseUrl);
  }

  async json<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      query?: Record<string, unknown>;
      body?: unknown;
      /**
       * Запрос без заголовка Authorization. Нужен для /api/h2h/public-key —
       * единственной операции, объявленной без авторизации. Слать туда фиктивный
       * токен рискованно: сервер может отклонить заведомо неверный токен там,
       * где запрос вообще без заголовка прошёл бы.
       */
      anonymous?: boolean;
    } = {},
  ): Promise<T> {
    const { method = 'GET', query, body, anonymous = false } = options;

    if (!anonymous && !this.token) {
      throw new Error(
        'Не задан токен публичного API. Выпустите его через wata_terminal_api_token_create ' +
          'и положите в переменную окружения WATA_ACQ_TOKEN.',
      );
    }
    const url = this.baseUrl + path + buildQuery(query);

    for (let attempt = 0; ; attempt++) {
      const res = await this.limiter.schedule(async () => {
        const headers: Record<string, string> = {
          accept: 'application/json',
          'user-agent': USER_AGENT,
        };
        if (!anonymous && this.token) headers['authorization'] = `Bearer ${this.token}`;
        if (body !== undefined) headers['content-type'] = 'application/json';

        const r = await request(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: r.statusCode, body: await r.body.text() };
      });

      if (res.status >= 500 && attempt < this.maxRetries) {
        await sleep(backoffDelay(attempt));
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new WataHttpError(
          'Токен публичного API отклонён: он истёк, отозван или принадлежит другому терминалу',
          res.status,
          path,
        );
      }

      if (res.status >= 400) {
        const parsed = safeParse(res.body) as { message?: string; error?: string } | undefined;
        throw new WataHttpError(
          parsed?.message ?? parsed?.error ?? `Запрос к ${path} завершился со статусом ${res.status}`,
          res.status,
          path,
          parsed,
        );
      }

      if (!res.body) return undefined as T;
      return (safeParse(res.body) ?? res.body) as T;
    }
  }
}

function safeParse(body: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) parts.push(enc(key, v));
    } else {
      parts.push(enc(key, value));
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const enc = (k: string, v: unknown) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
