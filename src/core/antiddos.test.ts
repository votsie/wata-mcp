import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, backoffDelay, looksLikeChallenge, sleep } from './antiddos.js';

test('запросы не выполняются параллельно, даже если длятся дольше интервала', async () => {
  const limiter = new RateLimiter(10);
  let active = 0;
  let maxActive = 0;

  const task = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await sleep(50); // заметно дольше интервала троттлера
    active--;
  };

  await Promise.all(Array.from({ length: 5 }, () => limiter.schedule(task)));

  // Раньше очередь сериализовала только старт, и все пять шли одновременно.
  assert.equal(maxActive, 1, 'одновременно должен выполняться только один запрос');
});

test('выдерживает паузу между запросами', async () => {
  const limiter = new RateLimiter(30);
  const stamps: number[] = [];

  for (let i = 0; i < 3; i++) {
    await limiter.schedule(async () => {
      stamps.push(Date.now());
    });
  }

  assert.ok(stamps[1]! - stamps[0]! >= 25, 'пауза между первым и вторым запросом слишком мала');
  assert.ok(stamps[2]! - stamps[1]! >= 25, 'пауза между вторым и третьим запросом слишком мала');
});

test('ошибка одного запроса не ломает очередь', async () => {
  const limiter = new RateLimiter(1);

  await assert.rejects(
    limiter.schedule(async () => {
      throw new Error('сетевой сбой');
    }),
    /сетевой сбой/,
  );

  const result = await limiter.schedule(async () => 'следующий прошёл');
  assert.equal(result, 'следующий прошёл');
});

test('возвращает значение выполненной задачи', async () => {
  const limiter = new RateLimiter(1);
  assert.equal(await limiter.schedule(async () => 42), 42);
});

test('backoff растёт и остаётся в разумных пределах', () => {
  assert.ok(backoffDelay(0) >= 500 && backoffDelay(0) < 1000);
  assert.ok(backoffDelay(5) <= 8000 + 250, 'задержка не должна расти безгранично');
  assert.ok(backoffDelay(3) > backoffDelay(0));
});

test('распознаёт ответ защиты, а не приложения', () => {
  assert.equal(looksLikeChallenge(429, 'ddos-guard', ''), true);
  assert.equal(looksLikeChallenge(403, 'ddos-guard', ''), true);
  // 400 от самого приложения защитой не считается — иначе клиент зря пойдёт в ретраи.
  assert.equal(looksLikeChallenge(400, 'ddos-guard', ''), false);
  assert.equal(looksLikeChallenge(429, 'nginx', ''), false);
});
