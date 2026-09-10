#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WataSession } from './core/session.js';
import { audit } from './core/audit.js';
import { authTools } from './tools/auth.js';
import { lkTools } from './tools/lk.js';
import { terminalTools } from './tools/terminals.js';
import { paymentTools } from './tools/payments.js';
import { walletTools } from './tools/wallet.js';
import { supportTools } from './tools/support.js';
import { acquiringTools } from './tools/acquiring.js';
import { webhookTools } from './tools/webhooks.js';
import { digitalGoodsTools } from './tools/digital-goods.js';
import type { ToolContext, ToolDef } from './tools/registry.js';

/**
 * Эти инструменты не требуют сессии кабинета: часть из них её и устанавливает,
 * остальные работают по JWT публичного API или вовсе без авторизации.
 */
const AUTH_FREE = new Set([
  'wata_auth_status',
  'wata_auth_login',
  'wata_auth_verify',
  // Выход не должен требовать живой сессии: его зовут именно тогда, когда она сломалась.
  'wata_auth_logout',
]);

const SESSION_FREE_PREFIXES = ['wata_acq_', 'wata_dg_', 'wata_webhook_'];

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'wata-mcp', version: '0.1.0' });
  const session = WataSession.create();
  const ctx: ToolContext = { session };

  const all = [
    ...authTools,
    ...lkTools,
    ...terminalTools,
    ...paymentTools,
    ...walletTools,
    ...supportTools,
    ...acquiringTools,
    ...webhookTools,
    ...digitalGoodsTools,
  ];

  for (const tool of all) {
    register(server, tool, ctx);
  }
  return server;
}

function register(server: McpServer, tool: ToolDef, ctx: ToolContext): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (args: Record<string, unknown>) => {
      try {
        // Инструменты входа обязаны работать без действующей сессии.
        const needsSession =
          !AUTH_FREE.has(tool.name) &&
          !SESSION_FREE_PREFIXES.some((prefix) => tool.name.startsWith(prefix));
        if (needsSession) await ctx.session.ensure();

        const result = await tool.handler(args ?? {}, ctx);
        if (tool.mutating) audit(tool.name, args, 'ok');

        return {
          content: [{ type: 'text' as const, text: stringify(result) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (tool.mutating) audit(tool.name, args, 'error', message);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
        };
      }
    },
  );
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '(пустой ответ)';
  return JSON.stringify(value, null, 2);
}

const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMain) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout занят протоколом MCP — диагностика только в stderr
  process.stderr.write('wata-mcp: stdio-сервер запущен\n');
}
