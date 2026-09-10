import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertApiPath, pathSegment } from './url.js';

const ORIGIN = 'https://merchant.wata.pro';

test('пропускает нормальный путь и сохраняет строку запроса', () => {
  assert.equal(assertApiPath('/api/merchant/terminals', ORIGIN), '/api/merchant/terminals');
  assert.equal(
    assertApiPath('/api/merchant/transactions?SkipCount=0', ORIGIN),
    '/api/merchant/transactions?SkipCount=0',
  );
});

test('отклоняет выход за пределы /api/ через точечные сегменты', () => {
  // Строковая проверка startsWith такое пропускала: URL схлопывает ".." уже после неё.
  assert.throws(() => assertApiPath('/api/../admin/subscriptions', ORIGIN), /пределы \/api\//);
  assert.throws(() => assertApiPath('/api/../../etc', ORIGIN), /пределы \/api\//);
  assert.throws(() => assertApiPath('/api/merchant/../../admin', ORIGIN), /пределы \/api\//);
});

test('отклоняет путь, не начинающийся с /api/', () => {
  assert.throws(() => assertApiPath('/admin/x', ORIGIN), /должен начинаться/);
  assert.throws(() => assertApiPath('https://evil.example/api/x', ORIGIN), /должен начинаться/);
});

test('не даёт увести запрос на чужой хост', () => {
  // Схемо-относительный URL: "//evil.example/api/x" ведёт на другой хост.
  assert.throws(() => assertApiPath('//evil.example/api/x', ORIGIN), /должен начинаться|другой хост/);
});

test('pathSegment кодирует значение и режет разделители пути', () => {
  assert.equal(pathSegment('00000000-1111-2222-3333-444444444444'), '00000000-1111-2222-3333-444444444444');
  assert.equal(pathSegment('a b'), 'a%20b');

  assert.throws(() => pathSegment('../subscriptions'), /разделители пути/);
  assert.throws(() => pathSegment('a/b'), /разделители пути/);
  assert.throws(() => pathSegment('..'), /разделители пути/);
  assert.throws(() => pathSegment('   '), /Пустой/);
});

test('идентификатор с ".." не подменяет эндпоинт', () => {
  // Сценарий из ревью: значение id уводит "получить транзакцию" на другой путь.
  assert.throws(() => `/api/merchant/transactions/${pathSegment('../refunds')}`, /разделители пути/);
});
