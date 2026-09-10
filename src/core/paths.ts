import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Все секреты живут ВНЕ репозитория: репозиторий публичный.
 * Переопределяется через WATA_HOME.
 */
export function wataHome(): string {
  const dir = process.env.WATA_HOME?.trim() || join(homedir(), '.wata-mcp');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * У боевого контура и песочницы разные учётные данные, поэтому и сессии
 * хранятся раздельно: общий файл приводил бы к тому, что куки одного окружения
 * отправляются в другое, а вход «молча» переставал работать.
 */
export const sessionFile = () =>
  join(wataHome(), process.env.WATA_ENV === 'sandbox' ? 'session.sandbox.json' : 'session.json');

export const auditFile = () => join(wataHome(), 'audit.log');
