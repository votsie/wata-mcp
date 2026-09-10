/**
 * Слой защиты от срабатывания DDoS-Guard, который стоит перед merchant.wata.pro.
 *
 * Наблюдения с живого стенда:
 *  - ответы приходят с `server: ddos-guard`, куки __ddg8_/__ddg10_ ротируются каждый ответ;
 *  - запросы без правдоподобного набора браузерных заголовков отбиваются;
 *  - слишком плотная очередь запросов приводит к отказам, поэтому троттлинг обязателен.
 */

const CHROME_VERSION = '140';

export const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

/** Заголовки, которые реальный SPA отправляет с каждым XHR. */
export function browserHeaders(origin: string): Record<string, string> {
  return {
    'user-agent': USER_AGENT,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': `"Chromium";v="${CHROME_VERSION}", "Not=A?Brand";v="24", "Google Chrome";v="${CHROME_VERSION}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    origin,
    referer: `${origin}/`,
  };
}

/**
 * Последовательный троттлер: запросы идут строго по одному, с паузой между ними.
 *
 * Важно дожидаться именно ЗАВЕРШЕНИЯ запроса, а не только его старта. Если ставить
 * в очередь лишь ожидание паузы, то запрос, идущий дольше интервала, не задержит
 * следующий — и по защите прилетит пачка параллельных соединений. Вторая причина
 * та же серьёзная: DDoS-Guard ротирует куки в каждом ответе, и при параллельных
 * запросах ответ, пришедший позже, может перезаписать более свежие куки старыми.
 */
export class RateLimiter {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(private readonly minIntervalMs: number) {}

  /** Ставит вызов в очередь, выдерживая паузу от завершения предыдущего запроса. */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      try {
        return await fn();
      } finally {
        // Отсчёт паузы ведём от конца запроса, а не от его начала.
        this.last = Date.now();
      }
    });

    // Очередь не должна рваться из-за ошибки одного запроса.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Экспоненциальная задержка с джиттером — чтобы повторы не били в такт. */
export function backoffDelay(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  return base + Math.random() * 250;
}

/** Признак того, что нас режет защита, а не приложение. */
export function looksLikeChallenge(status: number, server: string | undefined, body: string): boolean {
  if (!server?.includes('ddos-guard')) return false;
  if (status === 403 || status === 429 || status === 503) return true;
  return body.includes('ddos-guard') && body.includes('<html');
}
