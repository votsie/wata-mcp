import { appendFileSync } from 'node:fs';
import { auditFile } from './paths.js';

/**
 * Журнал изменяющих операций.
 *
 * Пользователь сознательно разрешил все мутации без подтверждений, включая
 * операции с деньгами. Журнал — единственный способ восстановить, что именно
 * сделал агент, если что-то пойдёт не так, поэтому пишется всегда.
 */
export function audit(tool: string, args: unknown, outcome: 'ok' | 'error', detail?: string): void {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    tool,
    args: redact(args),
    outcome,
    detail,
  });
  try {
    appendFileSync(auditFile(), line + '\n', { mode: 0o600 });
  } catch {
    // журнал не должен ронять вызов инструмента
  }
}

const SECRET_KEYS = /password|token|cookie|secret|(^|_)code$|cvv|(^|_)pan$|card(number|crypto)?$/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[скрыто]' : redact(v);
    }
    return out;
  }
  return value;
}
