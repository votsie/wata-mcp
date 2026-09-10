import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar } from './cookiejar.js';

test('подхватывает Set-Cookie и отдаёт его в заголовке Cookie', () => {
  const jar = new CookieJar();
  jar.applySetCookie(['auth_cookie=abc; path=/; httponly', 'XSRF-TOKEN=xyz; path=/']);
  assert.equal(jar.get('auth_cookie'), 'abc');
  assert.ok(jar.header().includes('auth_cookie=abc'));
  assert.ok(jar.header().includes('XSRF-TOKEN=xyz'));
});

test('не режет дату внутри Expires на части', () => {
  const jar = new CookieJar();
  // Одна кука, но с запятой внутри Expires — наивный split по запятой её сломает.
  jar.applySetCookie('__ddg8_=val1; Domain=.wata.pro; Path=/; Expires=Tue, 10-Sep-2030 06:52:16 GMT');
  assert.equal(jar.get('__ddg8_'), 'val1');
});

test('разбирает несколько кук, склеенных в один заголовок', () => {
  const jar = new CookieJar();
  jar.applySetCookie('a=1; Path=/, b=2; Path=/');
  assert.equal(jar.get('a'), '1');
  assert.equal(jar.get('b'), '2');
});

test('удаляет куку, которую сервер гасит истёкшим сроком', () => {
  const jar = new CookieJar();
  jar.applySetCookie('2fa_cookie=value; path=/');
  assert.equal(jar.get('2fa_cookie'), 'value');

  jar.applySetCookie('2fa_cookie=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/');
  assert.equal(jar.get('2fa_cookie'), undefined);
});

test('считает сессию действующей только при наличии auth_cookie', () => {
  const jar = new CookieJar();
  assert.equal(jar.isAuthenticated(), false);
  jar.ingestCookieString('XSRF-TOKEN=t; __ddg1_=x');
  assert.equal(jar.isAuthenticated(), false);
  jar.ingestCookieString('auth_cookie=live');
  assert.equal(jar.isAuthenticated(), true);
});

test('игнорирует куку с истёкшим max-age', () => {
  const jar = new CookieJar();
  jar.applySetCookie('temp=value; max-age=-10');
  assert.equal(jar.get('temp'), undefined);
});

test('ingestCookieString разбирает строку из DevTools', () => {
  const jar = new CookieJar();
  jar.ingestCookieString('auth_cookie=session-value; XSRF-TOKEN=xsrf-value; __ddg9_=203.0.113.1');
  assert.equal(jar.get('auth_cookie'), 'session-value');
  assert.equal(jar.get('__ddg9_'), '203.0.113.1');
});
