import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sessionFile } from './paths.js';

export interface StoredCookie {
  name: string;
  value: string;
  expires?: number;
}

/**
 * Минимальный cookie jar под один хост (merchant.wata.pro).
 *
 * Отдельный класс нужен по двум причинам:
 *  - DDoS-Guard переписывает __ddg8_/__ddg10_ буквально в каждом ответе, и если
 *    не подхватывать их обратно, запросы начинают отбиваться;
 *  - ASP.NET ротирует XSRF-TOKEN, а его значение обязано ехать в заголовке.
 */
export class CookieJar {
  private jar = new Map<string, StoredCookie>();

  /** Разбирает заголовки Set-Cookie из ответа и обновляет хранилище. */
  applySetCookie(headers: string[] | string | undefined): void {
    if (!headers) return;
    const list = Array.isArray(headers) ? headers : [headers];
    for (const raw of list) {
      for (const piece of splitCookieHeader(raw)) {
        const [pair, ...attrs] = piece.split(';');
        const eq = pair?.indexOf('=') ?? -1;
        if (!pair || eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();

        let expires: number | undefined;
        for (const attr of attrs) {
          const [k, v] = attr.split('=');
          const key = k?.trim().toLowerCase();
          if (key === 'max-age' && v) expires = Date.now() + Number(v) * 1000;
          else if (key === 'expires' && v && expires === undefined) {
            const t = Date.parse(v.trim());
            if (!Number.isNaN(t)) expires = t;
          }
        }

        // Пустое значение с прошедшим сроком = сервер гасит куку (например 2fa_cookie).
        if (value === '' && expires !== undefined && expires <= Date.now()) {
          this.jar.delete(name);
          continue;
        }
        this.jar.set(name, { name, value, expires });
      }
    }
  }

  get(name: string): string | undefined {
    const c = this.jar.get(name);
    if (!c) return undefined;
    if (c.expires !== undefined && c.expires <= Date.now()) {
      this.jar.delete(name);
      return undefined;
    }
    return c.value;
  }

  set(name: string, value: string, expires?: number): void {
    this.jar.set(name, { name, value, expires });
  }

  /** Значение заголовка Cookie для исходящего запроса. */
  header(): string {
    const now = Date.now();
    const out: string[] = [];
    for (const c of this.jar.values()) {
      if (c.expires !== undefined && c.expires <= now) continue;
      out.push(`${c.name}=${c.value}`);
    }
    return out.join('; ');
  }

  /** Разбирает строку вида "a=1; b=2" (ручной ввод из DevTools). */
  ingestCookieString(str: string): void {
    for (const pair of str.split(';')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      this.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  isAuthenticated(): boolean {
    return Boolean(this.get('auth_cookie'));
  }

  toJSON(): StoredCookie[] {
    return [...this.jar.values()];
  }

  load(cookies: StoredCookie[]): void {
    for (const c of cookies) this.jar.set(c.name, c);
  }

  save(): void {
    writeFileSync(sessionFile(), JSON.stringify({ cookies: this.toJSON() }, null, 2), {
      mode: 0o600,
    });
  }

  static restore(): CookieJar {
    const jar = new CookieJar();
    const file = sessionFile();
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { cookies?: StoredCookie[] };
        if (parsed.cookies) jar.load(parsed.cookies);
      } catch {
        // повреждённый файл сессии — начинаем с чистого листа
      }
    }
    return jar;
  }
}

/**
 * Некоторые прокси склеивают несколько Set-Cookie в один заголовок через перевод
 * строки или запятую. Запятую нельзя резать наивно: она встречается внутри Expires
 * ("Expires=Thu, 10-Sep-2026 ..."), поэтому режем только там, где следом идёт `name=`.
 */
function splitCookieHeader(raw: string): string[] {
  return raw
    .split('\n')
    .flatMap((line) => line.split(/,(?=\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=)/))
    .map((s) => s.trim())
    .filter(Boolean);
}
