import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { LIMITS, RATE_LIMITS } from '@secure-notes/shared';
import { hashSessionToken } from '../src/lib/session-token.js';
import { backends } from './helpers/backends.js';
import { b64 } from './helpers/fixtures.js';
import { createHarness } from './helpers/harness.js';

describe.each(backends)('phiên đăng nhập và lịch sử [$name]', (backend) => {
  let db;
  let h;
  let alice;

  beforeEach(async () => {
    db = await backend.create();
    h = await createHarness(db);
    alice = await h.signUp('alice@example.com');
  });

  afterEach(() => h.close());

  const list = (user, extra) => user.req('GET', '/api/sessions', undefined, extra);
  const revoke = (user, body, extra) => user.req('POST', '/api/sessions/revoke', body, extra);
  const alive = (token) => h.send('GET', '/api/me', { token }).then((r) => r.statusCode);

  describe('GET /api/sessions', () => {
    test('liệt kê mọi phiên còn hạn của mình, đánh dấu đúng phiên hiện tại', async () => {
      const phone = await h.login(alice.email, alice.authKey, {
        headers: { 'user-agent': 'Điện thoại thử' },
      });

      const res = await list(alice);

      expect(res.statusCode).toBe(200);
      const sessions = res.json();
      expect(sessions).toHaveLength(2);
      const current = sessions.find((s) => s.current);
      const other = sessions.find((s) => !s.current);
      expect(current.id).toBe(hashSessionToken(alice.token));
      expect(other.id).toBe(hashSessionToken(phone));
      expect(other.userAgent).toBe('Điện thoại thử');
      expect(Object.keys(current).sort()).toEqual(
        ['createdAt', 'current', 'expiresAt', 'id', 'ip', 'lastSeenAt', 'userAgent'].sort(),
      );
    });

    test('không bao giờ trả token gốc trong cookie', async () => {
      const res = await list(alice);
      expect(res.body).not.toContain(alice.token);
    });

    test('không thấy phiên của người khác', async () => {
      await h.signUp('bob@example.com');
      const res = await list(alice);
      expect(res.json()).toHaveLength(1);
    });

    test('phiên đã hết hạn không hiện ra', async () => {
      const old = await alice.newSession();
      await db.session.updateMany({
        where: { id: hashSessionToken(old) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const ids = (await list(alice)).json().map((s) => s.id);

      expect(ids).toEqual([hashSessionToken(alice.token)]);
    });

    test('chưa đăng nhập: 401', async () => {
      const res = await h.send('GET', '/api/sessions');
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHENTICATED');
    });
  });

  describe('POST /api/sessions/revoke', () => {
    test('đăng xuất đúng một thiết bị, các phiên khác còn nguyên', async () => {
      const phone = await alice.newSession();
      const tablet = await alice.newSession();

      const res = await revoke(alice, {
        authKey: alice.authKey,
        sessionId: hashSessionToken(phone),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ revoked: 1 });
      expect(await alive(phone)).toBe(401);
      expect(await alive(tablet)).toBe(200);
      expect(await alive(alice.token)).toBe(200);
    });

    test('không có sessionId: đăng xuất mọi thiết bị khác, giữ phiên hiện tại', async () => {
      const phone = await alice.newSession();
      const tablet = await alice.newSession();
      const bob = await h.signUp('bob@example.com');

      const res = await revoke(alice, { authKey: alice.authKey });

      expect(res.json()).toEqual({ revoked: 2 });
      expect(await alive(phone)).toBe(401);
      expect(await alive(tablet)).toBe(401);
      expect(await alive(alice.token)).toBe(200);
      expect(await alive(bob.token)).toBe(200);
    });

    test('sai mật khẩu: 401 INVALID_CREDENTIALS và không phiên nào bị hủy (ASVS 7.5.2)', async () => {
      const phone = await alice.newSession();

      const one = await revoke(alice, { authKey: b64(32), sessionId: hashSessionToken(phone) });
      const all = await revoke(alice, { authKey: b64(32) });

      for (const res of [one, all]) {
        expect(res.statusCode).toBe(401);
        expect(res.json().code).toBe('INVALID_CREDENTIALS');
      }
      expect(await alive(phone)).toBe(200);
    });

    test('thiếu authKey bị từ chối: cookie phiên thôi là chưa đủ', async () => {
      const phone = await alice.newSession();

      const res = await revoke(alice, { sessionId: hashSessionToken(phone) });

      expect(res.statusCode).toBe(400);
      expect(await alive(phone)).toBe(200);
    });

    test('dùng mật khẩu của chính mình không hủy được phiên của người khác: NOT_FOUND', async () => {
      const bob = await h.signUp('bob@example.com');

      const res = await revoke(alice, {
        authKey: alice.authKey,
        sessionId: hashSessionToken(bob.token),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
      expect(await alive(bob.token)).toBe(200);
    });

    test('id không tồn tại: NOT_FOUND, giống hệt id của người khác', async () => {
      const res = await revoke(alice, { authKey: alice.authKey, sessionId: 'a'.repeat(64) });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    test('không hủy phiên hiện tại qua đây (phải dùng đăng xuất)', async () => {
      const res = await revoke(alice, {
        authKey: alice.authKey,
        sessionId: hashSessionToken(alice.token),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
      expect(await alive(alice.token)).toBe(200);
    });

    test('sessionId sai định dạng hoặc thêm trường lạ: 400', async () => {
      const badId = await revoke(alice, { authKey: alice.authKey, sessionId: 'khong-phai-hex' });
      const extra = await revoke(alice, { authKey: alice.authKey, userId: 'x' });
      expect(badId.statusCode).toBe(400);
      expect(extra.statusCode).toBe(400);
    });

    test('chưa đăng nhập: 401 trước cả khi đọc body', async () => {
      const res = await h.send('POST', '/api/sessions/revoke', {
        payload: { authKey: alice.authKey },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHENTICATED');
      expect(await alive(alice.token)).toBe(200);
    });

    test('phiên vừa bị hủy thì chính nó không gọi tiếp được', async () => {
      const phone = await alice.newSession();
      await revoke(alice, { authKey: alice.authKey, sessionId: hashSessionToken(phone) });

      const res = await h.send('GET', '/api/sessions', { token: phone });

      expect(res.statusCode).toBe(401);
    });

    test('vượt giới hạn tần suất trả 429, kể cả khi lần sau dùng đúng mật khẩu', async () => {
      const phone = await alice.newSession();
      const ip = '192.0.2.70';
      for (let i = 0; i < RATE_LIMITS.REVOKE_SESSIONS.max; i++) {
        await revoke(alice, { authKey: b64(32) }, { ip });
      }

      const res = await revoke(alice, { authKey: alice.authKey }, { ip });

      expect(res.statusCode).toBe(429);
      expect(res.json().code).toBe('RATE_LIMITED');
      expect(await alive(phone)).toBe(200);
    });
  });

  describe('GET /api/login-history', () => {
    test('ghi cả lần thành công lẫn thất bại vào tài khoản mình, mới nhất trước', async () => {
      await h.send('POST', '/api/login', {
        payload: { email: alice.email, authKey: b64(32) },
        headers: { 'user-agent': 'Kẻ đoán mật khẩu' },
        ip: '198.51.100.7',
      });

      const res = await alice.req('GET', '/api/login-history');

      expect(res.statusCode).toBe(200);
      const history = res.json();
      expect(history).toHaveLength(2);
      const failed = history.find((e) => !e.success);
      expect(failed).toMatchObject({ ip: '198.51.100.7', userAgent: 'Kẻ đoán mật khẩu' });
      expect(history.some((e) => e.success)).toBe(true);
      expect(Object.keys(failed).sort()).toEqual(
        ['createdAt', 'id', 'ip', 'kind', 'success', 'userAgent'].sort(),
      );
      const times = history.map((e) => Date.parse(e.createdAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    test('không thấy lịch sử của người khác, cũng không thấy lần thử với email chưa đăng ký', async () => {
      const bob = await h.signUp('bob@example.com');
      await h.send('POST', '/api/login', {
        payload: { email: 'khong-ai@example.com', authKey: b64(32) },
      });

      const history = (await alice.req('GET', '/api/login-history')).json();
      const bobHistory = (await bob.req('GET', '/api/login-history')).json();

      expect(history).toHaveLength(1);
      expect(bobHistory).toHaveLength(1);
      expect(history[0].id).not.toBe(bobHistory[0].id);
    });

    test(`chỉ trả tối đa ${LIMITS.LOGIN_HISTORY_LIMIT} lần gần nhất`, async () => {
      for (let i = 0; i < LIMITS.LOGIN_HISTORY_LIMIT + 3; i++) {
        await db.loginHistory.create({
          data: {
            userId: (await db.user.findUnique({ where: { email: alice.email } })).id,
            emailAttempted: alice.email,
            success: false,
            createdAt: new Date(Date.now() - (i + 1) * 60_000),
          },
        });
      }

      const history = (await alice.req('GET', '/api/login-history')).json();

      expect(history).toHaveLength(LIMITS.LOGIN_HISTORY_LIMIT);
      // Lần đăng nhập thật (mới nhất) phải có mặt, không bị các dòng cũ đẩy ra.
      expect(history[0].success).toBe(true);
    });

    test('chưa đăng nhập: 401', async () => {
      const res = await h.send('GET', '/api/login-history');
      expect(res.statusCode).toBe(401);
    });
  });
});
