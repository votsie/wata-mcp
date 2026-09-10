/**
 * Безопасная сборка путей API.
 *
 * Проверять путь строкой недостаточно: `undici` парсит URL по правилам WHATWG,
 * а там точечные сегменты схлопываются. Строка `/api/../admin/x` пройдёт проверку
 * `startsWith('/api/')`, но уйдёт на `/admin/x` — с той же сессией и antiforgery-токеном.
 * Поэтому путь проверяется ПОСЛЕ нормализации.
 */

/**
 * Готовит значение для подстановки в путь.
 *
 * Идентификаторы приходят от модели, а не от разработчика: значение `../subscriptions`
 * в поле `id` увело бы «получить транзакцию» на совсем другой эндпоинт.
 */
export function pathSegment(value: string, field = 'идентификатор'): string {
  const trimmed = String(value).trim();
  if (!trimmed) throw new Error(`Пустой ${field}`);
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error(`Недопустимый ${field}: он не может содержать разделители пути`);
  }
  return encodeURIComponent(trimmed);
}

/**
 * Проверяет, что путь остаётся внутри /api/ после нормализации URL.
 * Возвращает нормализованный путь вместе со строкой запроса.
 */
export function assertApiPath(path: string, origin: string): string {
  if (!path.startsWith('/api/')) {
    throw new Error('Путь должен начинаться с /api/');
  }

  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    throw new Error('Некорректный путь запроса');
  }

  if (url.origin !== new URL(origin).origin) {
    throw new Error('Путь не должен уводить на другой хост');
  }
  if (!url.pathname.startsWith('/api/')) {
    throw new Error(
      'После нормализации путь выходит за пределы /api/ — вероятно, в нём есть сегменты ".."',
    );
  }

  return url.pathname + url.search;
}
