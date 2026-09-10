#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import { WataSession } from './core/session.js';
import { installAll } from './install/apply.js';
import { sessionFile, wataHome } from './core/paths.js';
import { merchantOrigin } from './core/http.js';

const command = process.argv[2] ?? 'help';

try {
  switch (command) {
    case 'login':
      await login();
      break;
    case 'install':
      doInstall();
      break;
    case 'doctor':
      await doctor();
      break;
    default:
      help();
  }
} catch (error) {
  stdout.write('Ошибка: ' + (error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}

function help(): void {
  const lines = [
    'wata-mcp — MCP-сервер для платёжной системы wata.pro',
    '',
    'Команды:',
    '  login     вход в личный кабинет',
    '              интерактивно:   wata-mcp login',
    '              в два шага:     wata-mcp login --start',
    '                              wata-mcp login --code <код из письма>',
    '  install   прописать сервер в конфиги Claude Code, Codex и Antigravity',
    '  doctor    диагностика: сессия, конфиги, доступность API',
    '',
    'Сервер запускается как stdio MCP: node dist/server.js',
    '',
  ];
  stdout.write(lines.join('\n'));
}

function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function report(session: WataSession): Promise<void> {
  const profile = (await session.http.json('/api/my-profile')) as { name?: string; email?: string };
  stdout.write('Аккаунт: ' + (profile.name ?? '—') + ' <' + (profile.email ?? '—') + '>\n');
  stdout.write('Сессия сохранена: ' + sessionFile() + '\n');
}

/**
 * Вход поддерживает два режима.
 *
 * Интерактивный — для человека за терминалом. Двухшаговый (--start, затем --code)
 * нужен агентам и CI: там некому отвечать на приглашение ввода, а код из письма
 * всё равно появляется только через некоторое время.
 */
async function login(): Promise<void> {
  const args = process.argv.slice(3);
  const codeArg = readFlag(args, '--code');
  const emailArg = readFlag(args, '--email');
  const passwordArg = readFlag(args, '--password');
  const session = WataSession.create();

  if (codeArg) {
    await session.verifyTwoFactor(codeArg);
    stdout.write('Вход подтверждён.\n');
    await report(session);
    return;
  }

  const nonInteractive = args.includes('--start') || (Boolean(emailArg) && Boolean(passwordArg));
  if (nonInteractive) {
    const email = emailArg ?? process.env.WATA_EMAIL;
    const password = passwordArg ?? process.env.WATA_PASSWORD;
    if (!email || !password) {
      throw new Error('Укажите --email и --password либо задайте WATA_EMAIL и WATA_PASSWORD');
    }
    const result = await session.login(email, password);
    if (result.status === 'authenticated') {
      await report(session);
      return;
    }
    stdout.write(result.message + '\n');
    stdout.write('Затем выполните: wata-mcp login --code <код из письма>\n');
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const email = process.env.WATA_EMAIL || (await rl.question('Почта: '));
    const password = process.env.WATA_PASSWORD || (await rl.question('Пароль: '));
    const result = await session.login(email.trim(), password.trim());

    if (result.status === 'authenticated') {
      stdout.write('Вход выполнен.\n');
    } else {
      stdout.write(result.message + '\n');
      const code = await rl.question('Код из письма: ');
      await session.verifyTwoFactor(code.trim());
      stdout.write('Вход подтверждён.\n');
    }
    await report(session);
  } finally {
    rl.close();
  }
}

function doInstall(): void {
  const projectDir = process.cwd();
  const reports = installAll(projectDir, { all: process.argv.includes('--all') });

  stdout.write('Установка WATA MCP:\n');
  for (const r of reports) {
    const mark = r.status === 'skipped' ? '—' : '+';
    stdout.write('  ' + mark + ' ' + r.target + ': ' + r.status + '\n    ' + r.path + '\n');
    if (r.note) stdout.write('    ' + r.note + '\n');
  }
  stdout.write('\nДалее выполните: npx wata-mcp login\n');
}

async function doctor(): Promise<void> {
  // Окружение выводим первым: перепутанный контур — самая дорогая ошибка здесь.
  const sandbox = process.env.WATA_ENV === 'sandbox';
  stdout.write('Окружение:      ' + (sandbox ? 'ПЕСОЧНИЦА' : 'БОЕВОЕ') + '\n');
  stdout.write('Кабинет:        ' + merchantOrigin() + '\n');
  stdout.write('Каталог данных: ' + wataHome() + '\n');
  stdout.write(
    'Файл сессии:    ' + sessionFile() + (existsSync(sessionFile()) ? ' (есть)' : ' (нет)') + '\n',
  );

  const session = WataSession.create();
  if (!session.isAuthenticated()) {
    stdout.write('Сессия: отсутствует. Выполните wata-mcp login\n');
    return;
  }

  try {
    const profile = (await session.http.json('/api/my-profile')) as { email?: string };
    stdout.write('Сессия: активна (' + (profile.email ?? 'без почты') + ')\n');
  } catch (e) {
    stdout.write('Сессия: недействительна — ' + (e as Error).message + '\n');
    return;
  }

  const probes: Array<[string, string]> = [
    ['Терминалы', '/api/merchant/terminals'],
    ['Транзакции', '/api/merchant/transactions/statuses'],
    ['Кошелёк', '/api/wallet/client/accounts/balances'],
    ['Выплаты', '/api/payout/merchant/payouts/history'],
    ['Цифровые товары', '/api/digital-goods/merchant/orders'],
  ];
  for (const [label, path] of probes) {
    try {
      await session.http.json(path, { query: { SkipCount: 0, MaxResultCount: 1 } });
      stdout.write('  ok   ' + label + '\n');
    } catch (e) {
      stdout.write('  сбой ' + label + ': ' + (e as Error).message + '\n');
    }
  }
}
