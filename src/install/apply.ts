import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { agentTargets, type AgentTarget } from './targets.js';

export interface InstallReport {
  target: string;
  status: 'installed' | 'updated' | 'skipped';
  path: string;
  note?: string;
}

/**
 * Прописывает stdio-сервер в конфигурацию каждого обнаруженного агента.
 *
 * Правки аккуратные: существующие настройки пользователя сохраняются,
 * перезаписывается только запись с нашим именем сервера.
 */
export function installAll(projectDir: string, opts: { all?: boolean } = {}): InstallReport[] {
  // Проектный .mcp.json попадает в публичный репозиторий, поэтому путь в нём
  // относительный: агент запускает сервер с корнем репозитория в качестве cwd.
  // Глобальным конфигам нужен абсолютный путь — они лежат вне проекта.
  const relativeEntry = { command: 'node', args: ['dist/server.js'] };
  const absoluteEntry = { command: 'node', args: [toPosix(projectDir) + '/dist/server.js'] };

  const reports: InstallReport[] = [];
  for (const target of agentTargets(projectDir)) {
    const detected = target.detectPaths.some((p) => existsSync(p));
    // Claude Code настраивается через файл в самом репозитории — он нужен всегда.
    const isProjectLocal = target.id === 'claude-code';

    if (!detected && !opts.all && !isProjectLocal) {
      reports.push({ target: target.label, status: 'skipped', path: target.configPath, note: 'агент не обнаружен' });
      continue;
    }

    try {
      const entry = isProjectLocal ? relativeEntry : absoluteEntry;
      const status =
        target.format === 'codex-toml'
          ? writeCodexToml(target, entry)
          : writeMcpServersJson(target, entry);
      reports.push({ target: target.label, status, path: target.configPath, note: target.docs });
    } catch (e) {
      reports.push({
        target: target.label,
        status: 'skipped',
        path: target.configPath,
        note: `ошибка: ${(e as Error).message}`,
      });
    }
  }
  return reports;
}

function writeMcpServersJson(
  target: AgentTarget,
  entry: { command: string; args: string[] },
): 'installed' | 'updated' {
  mkdirSync(dirname(target.configPath), { recursive: true });

  let config: { mcpServers?: Record<string, unknown> } = {};
  const existed = existsSync(target.configPath);
  if (existed) {
    const original = readFileSync(target.configPath, 'utf8');
    try {
      config = JSON.parse(original);
    } catch {
      // Это чужой конфиг: там могут быть другие MCP-серверы и настройки пользователя.
      // Молча перезаписать его пустым объектом — значит потерять их, поэтому
      // сначала сохраняем копию, и только потом начинаем с чистого файла.
      const backup = target.configPath + '.bak';
      writeFileSync(backup, original);
      throw new Error(
        `Конфигурация ${target.configPath} повреждена и не разбирается как JSON. ` +
          `Копия сохранена в ${backup}. Почините файл вручную и повторите установку.`,
      );
    }
  }

  config.mcpServers ??= {};
  const had = Boolean(config.mcpServers['wata']);
  config.mcpServers['wata'] = entry;

  writeFileSync(target.configPath, JSON.stringify(config, null, 2) + '\n');
  return had ? 'updated' : 'installed';
}

function writeCodexToml(
  target: AgentTarget,
  entry: { command: string; args: string[] },
): 'installed' | 'updated' {
  mkdirSync(dirname(target.configPath), { recursive: true });

  const section =
    '[mcp_servers.wata]\n' +
    `command = "${entry.command}"\n` +
    `args = [${entry.args.map((a) => `"${a}"`).join(', ')}]\n`;

  let content = existsSync(target.configPath) ? readFileSync(target.configPath, 'utf8') : '';

  // Заменяем существующую секцию целиком, не трогая остальной конфиг.
  // Секция тянется до следующего заголовка [..] или до конца файла. Якорь \Z
  // в JavaScript не поддерживается (читался бы как буква "Z"), поэтому конец
  // выражаем через «жадный набор строк, ни одна из которых не начинает секцию».
  const marker = /^\[mcp_servers\.wata\](?:(?!^\[)[\s\S])*/m;
  if (marker.test(content)) {
    content = content.replace(marker, section);
    writeFileSync(target.configPath, content);
    return 'updated';
  }

  if (content.length && !content.endsWith('\n')) content += '\n';
  writeFileSync(target.configPath, content + '\n' + section);
  return 'installed';
}

/** Windows-пути в конфигах агентов надёжнее хранить в POSIX-виде. */
function toPosix(p: string): string {
  return p.split(String.fromCharCode(92)).join('/');
}
