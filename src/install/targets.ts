import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AgentTarget {
  id: string;
  label: string;
  /** Файл конфигурации, который нужно изменить. */
  configPath: string;
  /** Формат: JSON с ключом mcpServers, либо TOML-секция Codex. */
  format: 'mcpServers' | 'codex-toml';
  /** Признак того, что агент вообще установлен у пользователя. */
  detectPaths: string[];
  docs: string;
}

/**
 * Куда именно прописывается stdio-сервер у каждого агента.
 * Пути выверены по документации соответствующих инструментов.
 */
export function agentTargets(projectDir: string): AgentTarget[] {
  const home = homedir();
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      // Проектный .mcp.json подхватывается автоматически при открытии репозитория.
      configPath: join(projectDir, '.mcp.json'),
      format: 'mcpServers',
      detectPaths: [join(home, '.claude'), join(home, '.claude.json')],
      docs: 'Проектный .mcp.json — подхватывается при открытии репозитория',
    },
    {
      id: 'codex',
      label: 'OpenAI Codex CLI',
      configPath: join(home, '.codex', 'config.toml'),
      format: 'codex-toml',
      detectPaths: [join(home, '.codex')],
      docs: 'Секция [mcp_servers.wata] в ~/.codex/config.toml',
    },
    {
      id: 'antigravity',
      label: 'Google Antigravity',
      configPath: join(home, '.gemini', 'config', 'mcp_config.json'),
      format: 'mcpServers',
      detectPaths: [join(home, '.gemini'), join(home, '.antigravity')],
      docs: 'Общий конфиг Antigravity IDE и CLI: ~/.gemini/config/mcp_config.json',
    },
  ];
}
