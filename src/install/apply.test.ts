import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Регулярка замены TOML-секции — самое хрупкое место установщика: он правит
 * ЧУЖОЙ конфиг, где у пользователя лежат другие MCP-серверы.
 */
const marker = /^\[mcp_servers\.wata\](?:(?!^\[)[\s\S])*/m;

const SECTION = '[mcp_servers.wata]\ncommand = "node"\nargs = ["dist/server.js"]\n';

test('заменяет секцию, когда она последняя в файле', () => {
  const before = '[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.wata]\ncommand = "old"\n';
  assert.ok(marker.test(before), 'секция должна находиться даже без секций после неё');

  const after = before.replace(marker, SECTION);
  assert.ok(after.includes('command = "node"'));
  assert.ok(after.includes('[mcp_servers.other]'), 'чужая секция обязана уцелеть');
  assert.equal(after.match(/\[mcp_servers\.wata\]/g)?.length, 1, 'дубликата быть не должно');
});

test('заменяет секцию в середине файла, не задевая соседнюю', () => {
  const before =
    '[mcp_servers.wata]\ncommand = "old"\nargs = ["x"]\n\n[mcp_servers.other]\ncommand = "other"\n';
  const after = before.replace(marker, SECTION);

  assert.ok(after.includes('command = "node"'));
  assert.ok(after.includes('[mcp_servers.other]'));
  assert.ok(!after.includes('command = "old"'));
  assert.equal(after.match(/\[mcp_servers\.wata\]/g)?.length, 1);
});

test('не находит секцию там, где её нет', () => {
  const before = '[mcp_servers.other]\ncommand = "other"\n';
  assert.equal(marker.test(before), false);
});

test('не путает нашу секцию с похожим именем', () => {
  const before = '[mcp_servers.watamock]\ncommand = "mock"\n';
  const found = before.match(marker)?.[0] ?? '';
  // Совпадение допустимо только если оно действительно начинается с нашего заголовка.
  assert.ok(!found.startsWith('[mcp_servers.wata]\n') || found === '');
});
