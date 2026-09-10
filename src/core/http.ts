import { request } from 'undici';
import { CookieJar } from './cookiejar.js';
import { RateLimiter, backoffDelay, browserHeaders, looksLikeChallenge, sleep } from './antiddos.js';

export const MERCHANT_ORIGIN = 'https://merchant.wata.pro';
export const MERCHANT_SANDBOX_ORIGIN = 'https://merchant-sandbox.wata.pro';

/**
 * Адрес кабинета для текущего окружения.
 *
 * Переключается тем же WATA_ENV, что и публичный API: иначе получилось бы, что
 * агент «работает в песочнице», а инструменты кабинета правят боевой аккаунт.
 * У песочницы отдельные учётные данные — боевые там не подойдут.
 */
export function merchantOrigin(): string {
  return process.env.WATA_ENV === 'sandbox' ? MERCHANT_SANDBOX_ORIGIN : MERCHANT_ORIGIN;
}

export class WataHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'WataHttpError';
  }
}

/** Сигнал верхнему уровню, что сессия умерла и нужен перелогин. */
export class WataAuthError extends WataHttpError {
  constructor(path: string, status = 401) {
    super('Сессия WATA недействительна — требуется повторный вход', status, path);
    this.name = 'WataAuthError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, unknown>;
  body?: unknown;
  /**
   * Явный Content-Type. Если задан, body отправляется как есть, без JSON.stringify —
   * это нужно для multipart-эндпоинтов вроде комментариев к тикетам.
   */
  contentType?: string;
  /** Не пытаться чинить antiforgery/повторять — используется самим механизмом починки. */
  raw?: boolean;
}

/**
 * HTTP-клиент личного кабинета.
 *
 * Главная неочевидность, ради которой существует этот класс: кабинет требует
 * заголовок `RequestVerificationToken`, равный куке `XSRF-TOKEN`, на КАЖДОМ запросе,
 * включая GET. Без него сервер отвечает `400` с ПУСТЫМ телом, что легко принять за
 * блокировку защиты. Клиент такой ответ распознаёт, обновляет antiforgery через
 * `/api/anti-forgery` и повторяет запрос один раз.
 */
export class WataHttp {
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;

  constructor(
    readonly jar: CookieJar,
    private readonly origin: string = merchantOrigin(),
  ) {
    this.limiter = new RateLimiter(Number(process.env.WATA_MIN_REQUEST_INTERVAL_MS ?? 350));
    this.maxRetries = Number(process.env.WATA_MAX_RETRIES ?? 3);
  }

  /** Получает свежие куки antiforgery (XSRF-TOKEN + .AspNetCore.Antiforgery.*). */
  async refreshAntiforgery(): Promise<void> {
    await this.send('/api/anti-forgery', { method: 'GET', raw: true });
  }

  async json<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.send(path, options);
    if (!res.body) return undefined as T;
    try {
      return JSON.parse(res.body) as T;
    } catch {
      return res.body as unknown as T;
    }
  }

  async send(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
    const { method = 'GET', query, body, contentType, raw = false } = options;
    const url = this.origin + path + buildQuery(query);

    let antiforgeryRepaired = false;

    for (let attempt = 0; ; attempt++) {
      const res = await this.limiter.schedule(async () => {
        const headers: Record<string, string> = {
          ...browserHeaders(this.origin),
          cookie: this.jar.header(),
        };

        const xsrf = this.jar.get('XSRF-TOKEN');
        if (xsrf) headers['requestverificationtoken'] = xsrf;
        if (body !== undefined) headers['content-type'] = contentType ?? 'application/json';

        const payload =
          body === undefined ? undefined : contentType ? (body as string | Buffer) : JSON.stringify(body);

        const r = await request(url, { method, headers, body: payload });

        this.jar.applySetCookie(r.headers['set-cookie'] as string[] | string | undefined);
        // Сохраняем сразу после каждого ответа, а не только при успехе: DDoS-Guard
        // ротирует куки в каждом ответе, и при падении процесса на неудачном запросе
        // свежие значения иначе потерялись бы.
        this.jar.save();

        const text = await r.body.text();
        return { status: r.statusCode, body: text, headers: r.headers as Record<string, unknown> };
      });

      if (raw) return res;

      const server = String(res.headers['server'] ?? '');

      // 400 с пустым телом = отсутствующий/протухший antiforgery-токен.
      if (res.status === 400 && res.body.length === 0 && !antiforgeryRepaired) {
        antiforgeryRepaired = true;
        await this.refreshAntiforgery();
        continue;
      }

      if (res.status === 401) throw new WataAuthError(path);

      if (looksLikeChallenge(res.status, server, res.body) && attempt < this.maxRetries) {
        await sleep(backoffDelay(attempt));
        continue;
      }

      if (res.status >= 500 && attempt < this.maxRetries) {
        await sleep(backoffDelay(attempt));
        continue;
      }

      if (res.status >= 400) {
        throw new WataHttpError(
          describeError(res.status, res.body, path, antiforgeryRepaired),
          res.status,
          path,
          safeParse(res.body),
        );
      }

      return res;
    }
  }
}

function describeError(
  status: number,
  body: string,
  path: string,
  antiforgeryRepaired: boolean,
): string {
  const parsed = safeParse(body) as { message?: string; error?: { message?: string } } | undefined;
  const message = parsed?.message ?? parsed?.error?.message;
  if (message) return `${message} (${status} ${path})`;

  if (status === 400 && body.length === 0) {
    // Если токен уже обновляли и ответ снова пустой, дело не в нём — не сбиваем с толку.
    return antiforgeryRepaired
      ? `400 без тела на ${path} даже после обновления antiforgery-токена. ` +
          'Вероятные причины: путь или параметры запроса неверны, либо сессия потеряла права.'
      : `400 без тела на ${path}: не принят antiforgery-токен (RequestVerificationToken)`;
  }

  return `Запрос к ${path} завершился со статусом ${status}`;
}

function safeParse(body: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Кабинет ждёт повторяющиеся ключи для массивов и не любит пустые значения. */
function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null) parts.push(enc(key, v));
    } else {
      parts.push(enc(key, value));
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const enc = (k: string, v: unknown) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
