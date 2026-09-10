#!/usr/bin/env node
/**
 * Запуск юнит-тестов.
 *
 * Почему не `node --test "dist-test/**\/*.test.js"`: glob-паттерны в аргументах
 * `--test` появились только в Node 21, а проект заявляет поддержку Node 20.
 * Почему не `node --test` без аргументов: он находит и `src/*.test.ts`, которые
 * без загрузчика TypeScript выполнить нельзя.
 *
 * Поэтому список файлов собирается явно и кроссплатформенно.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = 'dist-test';

if (!existsSync(ROOT)) {
  console.error(`Каталог ${ROOT} не найден. Сначала выполните: npm run build:test`);
  process.exit(1);
}

/** Рекурсивно собирает скомпилированные тесты. */
function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collect(full));
    else if (entry.name.endsWith('.test.js')) found.push(full);
  }
  return found;
}

const files = collect(ROOT).sort();

if (files.length === 0) {
  console.error(`В ${ROOT} нет скомпилированных тестов — проверьте tsconfig.test.json`);
  process.exit(1);
}

console.log(`Тестовых файлов: ${files.length}`);

// Пути передаём в POSIX-виде: так они одинаково читаются в выводе на всех платформах.
const args = ['--test', ...files.map((f) => f.split(sep).join('/'))];
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });

process.exit(result.status ?? 1);
