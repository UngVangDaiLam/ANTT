import { expect } from 'vitest';
import { SESSION } from '@secure-notes/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { registerBody } from './fixtures.js';

/**
 * Bộ dụng cụ cho test ở mức HTTP thuần: chỉ gọi API và đọc response, KHÔNG soi vào DB. Nhờ vậy
 * cùng một bộ test chạy được trên cả DB giả lẫn PostgreSQL thật (xem backends.js).
 *
 * @param {object} db Prisma client hoặc DB giả
 * @param {{ env?: object }} [options]
 */
export async function createHarness(db, { env = {} } = {}) {
  const app = await buildApp({ config: loadConfig(env), db });
  await app.ready();

  // Mỗi request một IP riêng để rate limit không ảnh hưởng các test khác.
  let counter = 0;
  const nextIp = () => {
    const n = ++counter;
    return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
  };

  /** Gửi request; `token` là token phiên, `ip` để ép nhiều request cùng một IP. */
  function send(method, url, { payload, token, ip, headers, cookies } = {}) {
    return app.inject({
      method,
      url,
      payload,
      headers,
      remoteAddress: ip ?? nextIp(),
      cookies: token ? { [SESSION.COOKIE_NAME]: token, ...cookies } : cookies,
    });
  }

  /** Đăng nhập, trả về token phiên trong cookie. */
  async function login(email, authKey, extra = {}) {
    const res = await send('POST', '/api/login', { payload: { email, authKey }, ...extra });
    expect(res.statusCode, `đăng nhập ${email}: ${res.body}`).toBe(200);
    return res.cookies.find((c) => c.name === SESSION.COOKIE_NAME).value;
  }

  /**
   * Đăng ký rồi đăng nhập một người dùng mới.
   * `user.req(method, url, payload, extra)` gửi request kèm phiên của người này.
   */
  async function signUp(email, overrides = {}) {
    const body = registerBody({ email, ...overrides });
    const res = await send('POST', '/api/register', { payload: body });
    expect(res.statusCode, `đăng ký ${email}: ${res.body}`).toBe(201);

    const user = { email, body, authKey: body.authKey, token: await login(email, body.authKey) };
    user.req = (method, url, payload, extra = {}) =>
      send(method, url, { payload, token: user.token, ...extra });
    /** Mở thêm một phiên nữa cho cùng người này (ví dụ đăng nhập trên thiết bị khác). */
    user.newSession = () => login(email, user.authKey);
    return user;
  }

  return { app, send, login, signUp, close: () => app.close() };
}
