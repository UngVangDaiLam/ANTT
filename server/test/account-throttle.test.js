import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ACCOUNT_THROTTLE, AUTH_ATTEMPT_KINDS } from '@secure-notes/shared';
import { hashSessionToken } from '../src/lib/session-token.js';
import { backends } from './helpers/backends.js';
import { b64, changePasswordBody } from './helpers/fixtures.js';
import { createHarness } from './helpers/harness.js';

const MINUTE = 60 * 1000;

describe.each(backends)('giới hạn theo tài khoản, D81 [$name]', (backend) => {
  let db;
  let h;
  let alice;

  /**
   * Đăng ký + đăng nhập, rồi đẩy lần đăng nhập đúng đó ra ngoài cửa sổ đếm. Nếu không, nó mới hơn
   * các lần sai được ghi sẵn với thời điểm trong quá khứ, và (đúng như thiết kế) đặt lại bộ đếm.
   */
  async function signUpLongAgo(email) {
    const user = await h.signUp(email);
    await pushHistoryOutOfWindow(email);
    return user;
  }

  function pushHistoryOutOfWindow(email) {
    return db.loginHistory.updateMany({
      where: { emailAttempted: email },
      data: { createdAt: new Date(Date.now() - 2 * ACCOUNT_THROTTLE.WINDOW_MS) },
    });
  }

  beforeEach(async () => {
    db = await backend.create();
    h = await createHarness(db);
    alice = await signUpLongAgo('alice@example.com');
  });

  afterEach(() => h.close());

  /** Mỗi request một IP khác (mặc định của harness): giới hạn theo IP không giúp gì ở đây. */
  const login = (email, authKey) => h.send('POST', '/api/login', { payload: { email, authKey } });

  /**
   * Ghi sẵn `count` lần sai cho `email`, lần gần nhất cách đây `lastAgoMs`. Nhanh hơn gọi login
   * thật, và đặt được thời điểm trong quá khứ để thử thời gian chờ.
   */
  async function seedFailures(email, count, lastAgoMs = 0) {
    const last = Date.now() - lastAgoMs;
    for (let i = 0; i < count; i++) {
      await db.loginHistory.create({
        data: {
          userId: null,
          emailAttempted: email,
          success: false,
          createdAt: new Date(last - i * 1000),
        },
      });
    }
  }

  const historyCount = async (user) => (await user.req('GET', '/api/login-history')).json().length;

  test(`sai ${ACCOUNT_THROTTLE.FREE_FAILURES - 1} lần vẫn đăng nhập đúng được`, async () => {
    await seedFailures(alice.email, ACCOUNT_THROTTLE.FREE_FAILURES - 1);
    expect((await login(alice.email, alice.authKey)).statusCode).toBe(200);
  });

  test(`sai ${ACCOUNT_THROTTLE.FREE_FAILURES} lần từ nhiều IP: lần sau, kể cả đúng mật khẩu, bị chặn có Retry-After`, async () => {
    for (let i = 0; i < ACCOUNT_THROTTLE.FREE_FAILURES; i++) {
      expect((await login(alice.email, b64(32))).statusCode).toBe(401);
    }

    const res = await login(alice.email, alice.authKey);

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(ACCOUNT_THROTTLE.BASE_DELAY_MS / 1000);
    expect(res.cookies).toHaveLength(0);
  });

  test('email chưa đăng ký bị chặn y hệt, không lộ email nào đã có tài khoản (D15)', async () => {
    const ghost = 'khong-ai@example.com';
    await seedFailures(alice.email, ACCOUNT_THROTTLE.FREE_FAILURES);
    await seedFailures(ghost, ACCOUNT_THROTTLE.FREE_FAILURES);

    const real = await login(alice.email, b64(32));
    const fake = await login(ghost, b64(32));

    expect(fake.statusCode).toBe(real.statusCode);
    expect(fake.json()).toEqual(real.json());
    expect(Boolean(fake.headers['retry-after'])).toBe(Boolean(real.headers['retry-after']));
  });

  test('hết thời gian chờ thì được thử lại', async () => {
    await seedFailures(
      alice.email,
      ACCOUNT_THROTTLE.FREE_FAILURES,
      ACCOUNT_THROTTLE.BASE_DELAY_MS + 1000,
    );
    expect((await login(alice.email, alice.authKey)).statusCode).toBe(200);
  });

  test('mỗi lần sai thêm, thời gian chờ gấp đôi', async () => {
    // 2 lần vượt mức miễn phí: chờ 4 phút tính từ lần sai gần nhất.
    await seedFailures(alice.email, ACCOUNT_THROTTLE.FREE_FAILURES + 2, 3 * MINUTE);
    expect((await login(alice.email, alice.authKey)).statusCode).toBe(429);

    const other = await signUpLongAgo('bob@example.com');
    await seedFailures(other.email, ACCOUNT_THROTTLE.FREE_FAILURES + 2, 5 * MINUTE);
    expect((await login(other.email, other.authKey)).statusCode).toBe(200);
  });

  test('thời gian chờ có trần, không khóa hẳn', async () => {
    await seedFailures(alice.email, 30, ACCOUNT_THROTTLE.MAX_DELAY_MS - MINUTE);
    expect((await login(alice.email, alice.authKey)).statusCode).toBe(429);

    const bob = await signUpLongAgo('bob@example.com');
    await seedFailures(bob.email, 30, ACCOUNT_THROTTLE.MAX_DELAY_MS + 1000);
    expect((await login(bob.email, bob.authKey)).statusCode).toBe(200);
  });

  test('lần đúng gần nhất đặt lại bộ đếm', async () => {
    await seedFailures(alice.email, ACCOUNT_THROTTLE.FREE_FAILURES, 10 * MINUTE);
    // Đăng nhập đúng xảy ra SAU các lần sai (trong beforeEach là trước, nên ghi thêm một lần).
    await db.loginHistory.create({
      data: {
        userId: null,
        emailAttempted: alice.email,
        success: true,
        createdAt: new Date(Date.now() - 5 * MINUTE),
      },
    });
    await seedFailures(alice.email, 1);

    expect((await login(alice.email, alice.authKey)).statusCode).toBe(200);
  });

  test('lần thử trong lúc bị chặn không được ghi, nên không kéo dài thời gian chờ', async () => {
    await seedFailures(alice.email, ACCOUNT_THROTTLE.FREE_FAILURES);
    const before = await historyCount(alice);

    for (let i = 0; i < 3; i++) await login(alice.email, b64(32));

    expect(await historyCount(alice)).toBe(before);
  });

  test('không ảnh hưởng tài khoản khác', async () => {
    const bob = await signUpLongAgo('bob@example.com');
    await seedFailures(alice.email, 20);
    expect((await login(bob.email, bob.authKey)).statusCode).toBe(200);
  });

  test('đổi mật khẩu: bị chặn chung với đăng nhập, mật khẩu không đổi', async () => {
    await seedFailures(alice.email, ACCOUNT_THROTTLE.FREE_FAILURES);

    const res = await alice.req('POST', '/api/change-password', changePasswordBody(alice.authKey));

    expect(res.statusCode).toBe(429);
    const salt = await h.send('POST', '/api/users/salt', { payload: { email: alice.email } });
    expect(salt.json().salt).toBe(alice.body.salt);
  });

  test('đổi mật khẩu sai mật khẩu cũ: được ghi vào lịch sử và tính vào giới hạn', async () => {
    for (let i = 0; i < ACCOUNT_THROTTLE.FREE_FAILURES; i++) {
      const res = await alice.req('POST', '/api/change-password', changePasswordBody(b64(32)), {
        ip: `198.51.100.${i + 1}`,
      });
      expect(res.statusCode).toBe(401);
    }

    const history = (await alice.req('GET', '/api/login-history')).json();
    expect(history.filter((e) => e.kind === AUTH_ATTEMPT_KINDS.CHANGE_PASSWORD)).toHaveLength(
      ACCOUNT_THROTTLE.FREE_FAILURES,
    );
    expect((await login(alice.email, alice.authKey)).statusCode).toBe(429);
  });

  test('đăng xuất từ xa: lần nhập lại mật khẩu được ghi, đúng lẫn sai, và cũng bị chặn chung', async () => {
    const phone = await alice.newSession();
    await pushHistoryOutOfWindow(alice.email);
    const revoke = (authKey) =>
      alice.req('POST', '/api/sessions/revoke', {
        authKey,
        sessionId: hashSessionToken(phone),
      });

    expect((await revoke(b64(32))).statusCode).toBe(401);
    const history = (await alice.req('GET', '/api/login-history')).json();
    expect(history[0]).toMatchObject({
      kind: AUTH_ATTEMPT_KINDS.REVOKE_SESSIONS,
      success: false,
    });

    await seedFailures(alice.email, ACCOUNT_THROTTLE.FREE_FAILURES);
    expect((await revoke(alice.authKey)).statusCode).toBe(429);
    expect((await h.send('GET', '/api/me', { token: phone })).statusCode).toBe(200);
  });

  test('đăng nhập đúng được ghi với kind = login', async () => {
    const carol = await h.signUp('carol@example.com');
    const history = (await carol.req('GET', '/api/login-history')).json();
    expect(history).toEqual([expect.objectContaining({ kind: 'login', success: true })]);
  });
});
