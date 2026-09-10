import { CookieJar } from './cookiejar.js';
import { WataAuthError, WataHttp } from './http.js';

export interface LoginResult {
  status: 'two_factor_required' | 'authenticated';
  message: string;
}

/**
 * Управление сессией личного кабинета.
 *
 * Флоу входа (снят с живого кабинета):
 *   1. GET  /api/anti-forgery        -> 204, ставит XSRF-TOKEN
 *   2. POST /api/auth/sign-in        -> 401 {isTwoFactorRequired:true} + кука 2fa_cookie
 *   3. POST /api/auth/2fa {token}    -> 200, ставит auth_cookie (max-age 60 дней)
 *
 * Обратите внимание: 401 на шаге 2 — это НЕ ошибка, а штатный запрос второго фактора.
 */
export class WataSession {
  constructor(
    readonly http: WataHttp,
    readonly jar: CookieJar,
  ) {}

  static create(): WataSession {
    const jar = CookieJar.restore();

    // Ручной режим: готовая cookie-строка из DevTools.
    const manual = process.env.WATA_COOKIE?.trim();
    if (manual) jar.ingestCookieString(manual);

    return new WataSession(new WataHttp(jar), jar);
  }

  isAuthenticated(): boolean {
    return this.jar.isAuthenticated();
  }

  /** Шаг 1-2: отправляет пароль и запрашивает код второго фактора. */
  async login(email: string, password: string): Promise<LoginResult> {
    await this.http.refreshAntiforgery();

    const res = await this.http.send('/api/auth/sign-in', {
      method: 'POST',
      body: { email, password },
      raw: true,
    });

    if (res.status === 200) {
      this.jar.save();
      return { status: 'authenticated', message: 'Вход выполнен без второго фактора' };
    }

    if (res.status === 401) {
      const parsed = tryParse(res.body);
      if (parsed?.isTwoFactorRequired) {
        this.jar.save();
        return {
          status: 'two_factor_required',
          message: parsed.reason ?? 'Введите код, отправленный на почту',
        };
      }
      throw new WataAuthError('/api/auth/sign-in');
    }

    throw new Error(
      `Вход не удался: статус ${res.status}${res.body ? ` — ${res.body.slice(0, 200)}` : ''}`,
    );
  }

  /** Шаг 3: подтверждает код и получает долгоживущую auth_cookie. */
  async verifyTwoFactor(code: string): Promise<void> {
    if (!this.jar.get('2fa_cookie')) {
      throw new Error('Нет активного запроса второго фактора — сначала выполните вход');
    }

    // raw, чтобы отличить неверный код от протухшей сессии: и то и другое даёт 401.
    const res = await this.http.send('/api/auth/2fa', {
      method: 'POST',
      body: { token: code },
      raw: true,
    });

    if (res.status === 401 || res.status === 400) {
      // Кука 2fa_cookie одноразовая: сервер гасит её при неудачной попытке, и следующий
      // запрос он уже не связывает с пользователем — отсюда сбивающее с толку
      // «Пользователь с таким email не найден» вместо «неверный код».
      //
      // Различить «код неверен» и «запрос второго фактора протух» по ответу надёжно
      // не получается, а последствие в обоих случаях одно: нужен новый вход.
      // Поэтому даём один честный совет вместо догадки о причине.
      const detail = extractReason(res.body);
      throw new Error(
        'Код не принят. Начните вход заново: wata_auth_login, затем сразу wata_auth_verify ' +
          'с новым кодом из письма — код живёт несколько минут, а неудачная попытка ' +
          'отменяет текущий запрос второго фактора.' +
          (detail ? ` Ответ сервера: ${detail}` : ''),
      );
    }
    if (res.status >= 400) {
      throw new Error('Подтверждение не удалось: статус ' + res.status);
    }

    if (!this.jar.isAuthenticated()) {
      throw new Error('Код принят, но сессия не установлена — повторите вход');
    }
    this.jar.save();
  }

  async logout(): Promise<void> {
    try {
      await this.http.send('/api/auth/sign-out', { method: 'POST' });
    } finally {
      this.jar.save();
    }
  }

  /**
   * Гарантирует рабочую сессию перед вызовом инструмента.
   * Неинтерактивный автологин возможен только до шага второго фактора —
   * код с почты всё равно придётся ввести через wata_auth_verify.
   */
  async ensure(): Promise<void> {
    if (this.isAuthenticated()) return;

    const email = process.env.WATA_EMAIL?.trim();
    const password = process.env.WATA_PASSWORD?.trim();
    if (email && password) {
      const result = await this.login(email, password);
      if (result.status === 'authenticated') return;
      throw new Error(
        'Требуется код двухфакторной аутентификации: вызовите wata_auth_verify с кодом из письма',
      );
    }

    throw new Error(
      'Нет активной сессии WATA. Выполните `npx wata-mcp login`, вызовите wata_auth_login ' +
        'или задайте WATA_COOKIE.',
    );
  }
}

function tryParse(body: string): { isTwoFactorRequired?: boolean; reason?: string } | undefined {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Достаёт человекочитаемую причину из ответа, если сервер её прислал. */
function extractReason(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { reason?: string; message?: string };
    return parsed.reason ?? parsed.message;
  } catch {
    return undefined;
  }
}
