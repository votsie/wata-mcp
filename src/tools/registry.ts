import { z } from 'zod';
import type { WataSession } from '../core/session.js';

export interface ToolContext {
  session: WataSession;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** Меняет состояние аккаунта — попадает в аудит-лог. */
  mutating?: boolean;
  schema: z.ZodRawShape;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** Общие для кабинета параметры offset-пагинации. */
export const pagingShape = {
  skipCount: z.number().int().min(0).optional().describe('Сколько записей пропустить'),
  maxResultCount: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Сколько записей вернуть (по умолчанию 20)'),
} satisfies z.ZodRawShape;

/** Период, который кабинет ждёт в виде From/To (YYYY-MM-DD). */
export const periodShape = {
  from: z.string().optional().describe('Начало периода, YYYY-MM-DD'),
  to: z.string().optional().describe('Конец периода, YYYY-MM-DD'),
} satisfies z.ZodRawShape;

export function pagingQuery(args: Record<string, unknown>): Record<string, unknown> {
  return {
    SkipCount: args.skipCount ?? 0,
    MaxResultCount: args.maxResultCount ?? 20,
  };
}

export function periodQuery(args: Record<string, unknown>): Record<string, unknown> {
  return { From: args.from, To: args.to };
}
