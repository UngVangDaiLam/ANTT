import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { KDF_DEFAULTS, LIMITS, RATE_LIMITS, SESSION } from '@secure-notes/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hashSessionToken } from '../src/lib/session-token.js';
import { createFakeDb } from './helpers/fake-db.js';
import { b64, registerBody } from './helpers/fixtures.js';

const SELF_ACCOUNT_KEYS = [
  'ed25519PublicKey',
  'email',
  'wrappedEd25519PrivateKey',
  'wrappedVaultKey',
  'wrappedX25519PrivateKey',
  'x25519PublicKey',
];

let app;
let db;
let ipCounter = 0;

/** Mỗi request một IP riêng để rate limit không ảnh hưởng các test khác. */
const nextIp = () => `10.0.0.${++ipCounter % 250}`;

const post = (url, payload, extra = {}) =>
  app.inject({ method: 'POST', url, payload, remoteAddress: nextIp(), ...extra });

const me = (token, extra = {}) =>
  app.inject({
    method: 'GET',
    url: '/api/me',
    cookies: token === undefined ? {} : { [SESSION.COOKIE_NAME]: token },
    ...extra,
  });

/** Đăng ký một tài khoản qua chính API rồi trả về body đã gửi (để có authKey gốc). */
async function registerUser(overrides = {}) {
  const body = registerBody(overrides);
  const res = await post('/api/register', body);
  expect(res.statusCode).toBe(201);
  return body;
}

/** Đăng nhập thành công, trả về token trong cookie và toàn bộ response. */
async function loginAs(user, extra = {}) {
  const res = await post('/api/login', { email: user.email, authKey: user.authKey }, extra);
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION.COOKIE_NAME);
  return { res, token: cookie.value };
}

beforeEach(async () => {
  db = createFakeDb();
  app = await buildApp({ config: loadConfig({}), db });
  await app.ready();
});

afterEach(() => app.close());

describe('GET /api/users/:email/salt', () => {
  const salt = (email, remoteAddress = nextIp()) =>
    app.inject({
      method: 'GET',
      url: `/api/users/${encodeURIComponent(email)}/salt`,
      remoteAddress,
    });

  test('trả đúng salt và kdfParams đã lưu của tài khoản', async () => {
    const user = await registerUser({ kdfParams: { opslimit: 4, memlimit: 128 * 1024 * 1024 } });
    const res = await salt(user.email);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      salt: user.salt,
      kdfParams: { opslimit: 4, memlimit: 128 * 1024 * 1024 },
    });
  });

  test('email khác hoa/thường và khoảng trắng vẫn ra salt thật', async () => {
    const user = await registerUser();
    const res = await salt(' LAM@Example.COM ');
    expect(res.json().salt).toBe(user.salt);
  });

  test('email chưa đăng ký vẫn trả 200 với salt trông y hệt salt thật (D15)', async () => {
    const real = await registerUser();
    const fake = await salt('khong-ton-tai@example.com');
    const genuine = await salt(real.email);

    expect(fake.statusCode).toBe(200);
    expect(Object.keys(fake.json()).sort()).toEqual(Object.keys(genuine.json()).sort());
    expect(fake.json().salt).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 byte base64url
    expect(fake.json().kdfParams).toEqual({ ...KDF_DEFAULTS });
  });

  test('salt giả cố định theo email: hỏi lại vẫn ra đúng giá trị cũ', async () => {
    const first = (await salt('ma@example.com')).json().salt;
    const again = (await salt('MA@example.com')).json().salt;
    expect(again).toBe(first);
  });

  test('salt giả khác nhau giữa các email', async () => {
    const a = (await salt('a@example.com')).json().salt;
    const b = (await salt('b@example.com')).json().salt;
    expect(a).not.toBe(b);
  });

  test('salt giả không trùng salt thật nào', async () => {
    const user = await registerUser();
    const fake = (await salt('khac@example.com')).json().salt;
    expect(fake).not.toBe(user.salt);
  });

  test('từ chối email sai định dạng', async () => {
    const res = await salt('khong-phai-email');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('vượt giới hạn tần suất trả 429 RATE_LIMITED', async () => {
    const ip = '192.0.2.10';
    for (let i = 0; i < RATE_LIMITS.SALT.max; i++) await salt('a@example.com', ip);
    const res = await salt('a@example.com', ip);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/login', () => {
  test('đăng nhập đúng trả 200 và đúng bộ khóa đã bọc, không thừa trường nào', async () => {
    const user = await registerUser();
    const { res } = await loginAs(user);
    const body = res.json();

    expect(Object.keys(body).sort()).toEqual(SELF_ACCOUNT_KEYS);
    expect(body).toEqual({
      email: user.email,
      wrappedVaultKey: user.wrappedVaultKey,
      x25519PublicKey: user.x25519PublicKey,
      ed25519PublicKey: user.ed25519PublicKey,
      wrappedX25519PrivateKey: user.wrappedX25519PrivateKey,
      wrappedEd25519PrivateKey: user.wrappedEd25519PrivateKey,
    });
  });

  test('response không lộ authKey, hash hay salt', async () => {
    const user = await registerUser();
    const { res } = await loginAs(user);
    expect(res.body).not.toContain(user.authKey);
    expect(res.body).not.toContain('authKeyHash');
    expect(res.body).not.toContain(user.salt);
  });

  test('cookie phiên: __Host-, httpOnly, Secure, SameSite=Strict, Path=/, không có Domain', async () => {
    const user = await registerUser();
    const { res } = await loginAs(user);
    const cookie = res.cookies.find((c) => c.name === SESSION.COOKIE_NAME);

    expect(SESSION.COOKIE_NAME.startsWith('__Host-')).toBe(true);
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION.TTL_MS / 1000,
    });
    expect(cookie.domain).toBeUndefined();
  });

  test('token có 256 bit ngẫu nhiên, mỗi lần đăng nhập một token khác', async () => {
    const user = await registerUser();
    const a = (await loginAs(user)).token;
    const b = (await loginAs(user)).token;
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  test('DB chỉ lưu SHA-256 của token, không lưu token gốc (lộ DB không dựng lại được cookie)', async () => {
    const user = await registerUser();
    const { token } = await loginAs(user);

    expect([...db.sessions.keys()]).toEqual([hashSessionToken(token)]);
    const stored = [...db.sessions.values()][0];
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.userId).toBe(db.users.get(user.email).id);
    const ttl = stored.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(SESSION.TTL_MS - 5000);
    expect(ttl).toBeLessThanOrEqual(SESSION.TTL_MS);
  });

  test('chuẩn hóa email khi đăng nhập', async () => {
    const user = await registerUser();
    const res = await post('/api/login', { email: '  LAM@Example.COM ', authKey: user.authKey });
    expect(res.statusCode).toBe(200);
  });

  test('sai authKey trả 401 INVALID_CREDENTIALS, không cấp cookie, không tạo phiên', async () => {
    const user = await registerUser();
    const res = await post('/api/login', { email: user.email, authKey: b64(32) });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
    expect(res.cookies).toEqual([]);
    expect(db.sessions.size).toBe(0);
  });

  test('email không tồn tại trả đúng cùng response với sai mật khẩu (không lộ tài khoản)', async () => {
    const user = await registerUser();
    const wrongPassword = await post('/api/login', { email: user.email, authKey: b64(32) });
    const unknownEmail = await post('/api/login', {
      email: 'khong-co@example.com',
      authKey: b64(32),
    });

    expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode);
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
    expect(unknownEmail.cookies).toEqual([]);
    expect(db.sessions.size).toBe(0);
  });

  test('ghi lịch sử cả lần thành công lẫn thất bại (ASVS 16.3.1)', async () => {
    const user = await registerUser();
    const userId = db.users.get(user.email).id;
    await post('/api/login', { email: user.email, authKey: user.authKey });
    await post('/api/login', { email: user.email, authKey: b64(32) });
    await post('/api/login', { email: 'la@example.com', authKey: b64(32) });

    expect(db.loginRecords.map((r) => [r.emailAttempted, r.success, r.userId])).toEqual([
      [user.email, true, userId],
      [user.email, false, userId],
      ['la@example.com', false, null],
    ]);
  });

  test('lịch sử đăng nhập lưu IP và User-Agent (đã bị cắt bớt), tuyệt đối không lưu authKey', async () => {
    const user = await registerUser();
    await post(
      '/api/login',
      { email: user.email, authKey: user.authKey },
      { remoteAddress: '203.0.113.7', headers: { 'user-agent': 'x'.repeat(5000) } },
    );

    const record = db.loginRecords[0];
    expect(record.ip).toBe('203.0.113.7');
    expect(record.userAgent).toHaveLength(LIMITS.MAX_USER_AGENT_LENGTH);
    expect(JSON.stringify(db.loginRecords)).not.toContain(user.authKey);
  });

  test('đăng nhập khi đang mang cookie cũ thì hủy phiên cũ và cấp phiên mới (ASVS 7.2.4)', async () => {
    const user = await registerUser();
    const { token: oldToken } = await loginAs(user);

    const { token: newToken } = await loginAs(user, {
      cookies: { [SESSION.COOKIE_NAME]: oldToken },
    });

    expect(newToken).not.toBe(oldToken);
    expect(db.sessions.size).toBe(1);
    expect((await me(oldToken)).statusCode).toBe(401);
    expect((await me(newToken)).statusCode).toBe(200);
  });

  test('từ chối trường lạ và thiếu trường', async () => {
    const user = await registerUser();
    const extra = await post('/api/login', { email: user.email, authKey: user.authKey, admin: 1 });
    const missing = await post('/api/login', { email: user.email });
    expect(extra.statusCode).toBe(400);
    expect(missing.statusCode).toBe(400);
    expect(db.sessions.size).toBe(0);
  });

  test('từ chối authKey sai độ dài', async () => {
    const user = await registerUser();
    const res = await post('/api/login', { email: user.email, authKey: b64(16) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('từ chối JSON chứa __proto__', async () => {
    const user = await registerUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      remoteAddress: nextIp(),
      headers: { 'content-type': 'application/json' },
      payload: `{"__proto__":{"isAdmin":true},"email":"${user.email}","authKey":"${user.authKey}"}`,
    });
    expect(res.statusCode).toBe(400);
    expect(db.sessions.size).toBe(0);
  });

  test('từ chối request từ Origin lạ (CSRF), không tạo phiên', async () => {
    const user = await registerUser();
    const res = await post(
      '/api/login',
      { email: user.email, authKey: user.authKey },
      { headers: { origin: 'https://evil.example' } },
    );
    expect(res.statusCode).toBe(403);
    expect(db.sessions.size).toBe(0);
  });

  test('vượt giới hạn tần suất trả 429, kể cả khi lần sau dùng đúng authKey', async () => {
    const user = await registerUser();
    const ip = '192.0.2.20';
    const attempt = (authKey) =>
      post('/api/login', { email: user.email, authKey }, { remoteAddress: ip });

    for (let i = 0; i < RATE_LIMITS.LOGIN.max; i++) await attempt(b64(32));
    const res = await attempt(user.authKey);

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
    expect(db.sessions.size).toBe(0);
  });

  test('lỗi DB không bị báo nhầm thành sai mật khẩu', async () => {
    const user = await registerUser();
    db.user.findUnique = async () => {
      throw new Error('mất kết nối');
    };
    const res = await post('/api/login', { email: user.email, authKey: user.authKey });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('INTERNAL_ERROR');
  });
});

describe('log của server', () => {
  test('không ghi authKey hay token phiên ra log', async () => {
    const lines = [];
    const logged = await buildApp({
      config: loadConfig({}),
      db,
      logger: { level: 'trace', stream: { write: (line) => lines.push(line) } },
    });
    await logged.ready();

    const user = registerBody();
    await logged.inject({ method: 'POST', url: '/api/register', payload: user });
    const res = await logged.inject({
      method: 'POST',
      url: '/api/login',
      payload: { email: user.email, authKey: user.authKey },
    });
    const token = res.cookies.find((c) => c.name === SESSION.COOKIE_NAME).value;
    await logged.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION.COOKIE_NAME]: token },
    });
    await logged.close();

    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0); // chắc chắn có log để mà kiểm tra
    expect(output).not.toContain(user.authKey);
    expect(output).not.toContain(token);
    expect(output).not.toContain(user.wrappedVaultKey.ciphertext);
  });
});

describe('GET /api/me', () => {
  test('phiên hợp lệ trả đúng dữ liệu tài khoản của chính mình', async () => {
    const user = await registerUser();
    const { token } = await loginAs(user);
    const res = await me(token);

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(SELF_ACCOUNT_KEYS);
    expect(res.json().email).toBe(user.email);
    expect(res.body).not.toContain('authKeyHash');
  });

  test('không có cookie trả 401 UNAUTHENTICATED', async () => {
    const res = await me(undefined);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  test.each([
    ['chuỗi rác', 'abc'],
    ['quá dài', 'A'.repeat(500)],
    ['ký tự ngoài base64url', `${'A'.repeat(42)}=`],
    ['rỗng', ''],
  ])('cookie %s bị từ chối', async (_name, token) => {
    const res = await me(token);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  test('token đúng hình dạng nhưng không có trong DB bị từ chối', async () => {
    await loginAs(await registerUser());
    const res = await me(b64(32));
    expect(res.statusCode).toBe(401);
  });

  test('kẻ trộm DB không dùng được id phiên (chỉ là SHA-256) làm cookie', async () => {
    const { token } = await loginAs(await registerUser());
    const storedId = hashSessionToken(token);
    expect((await me(storedId)).statusCode).toBe(401);
    expect((await me(Buffer.from(storedId, 'hex').toString('base64url'))).statusCode).toBe(401);
  });

  test('phiên hết hạn bị từ chối và bị xóa khỏi DB', async () => {
    const { token } = await loginAs(await registerUser());
    db.sessions.get(hashSessionToken(token)).expiresAt = new Date(Date.now() - 1000);

    const res = await me(token);
    expect(res.statusCode).toBe(401);
    expect(db.sessions.size).toBe(0);
  });

  test('ghi lại lastSeenAt khi đã cũ hơn ngưỡng, không ghi khi còn mới', async () => {
    const { token } = await loginAs(await registerUser());
    const row = db.sessions.get(hashSessionToken(token));

    const fresh = row.lastSeenAt;
    await me(token);
    expect(row.lastSeenAt).toBe(fresh);

    const stale = new Date(Date.now() - SESSION.TOUCH_INTERVAL_MS * 2);
    row.lastSeenAt = stale;
    await me(token);
    expect(row.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  test('phiên bị xóa (đăng xuất ở tab khác) đúng lúc đang xác thực: 401 chứ không phải 500', async () => {
    const { token } = await loginAs(await registerUser());
    const sessionId = hashSessionToken(token);
    db.sessions.get(sessionId).lastSeenAt = new Date(Date.now() - SESSION.TOUCH_INTERVAL_MS * 2);
    // Đọc được phiên, rồi ngay sau đó phiên bị xóa, trước khi kịp cập nhật lastSeenAt.
    const findUnique = db.session.findUnique;
    db.session.findUnique = async (args) => {
      const row = await findUnique(args);
      db.sessions.delete(sessionId);
      return row;
    };

    const res = await me(token);

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  test('phiên còn nhưng tài khoản đã biến mất thì coi như chưa đăng nhập', async () => {
    const user = await registerUser();
    const { token } = await loginAs(user);
    db.users.delete(user.email);
    const res = await me(token);
    expect(res.statusCode).toBe(401);
  });

  test('danh tính chỉ lấy từ phiên, bỏ qua email do client gửi kèm (D16)', async () => {
    const alice = await registerUser({ email: 'alice@example.com' });
    await registerUser({ email: 'bob@example.com' });
    const { token } = await loginAs(alice);

    const res = await me(token, {
      url: '/api/me?email=bob@example.com',
      headers: { 'x-email': 'bob@example.com' },
    });
    expect(res.json().email).toBe('alice@example.com');
  });

  test('hai người dùng cùng đăng nhập không lẫn phiên của nhau', async () => {
    const alice = await registerUser({ email: 'alice@example.com' });
    const bob = await registerUser({ email: 'bob@example.com' });
    const a = await loginAs(alice);
    const b = await loginAs(bob);

    expect((await me(a.token)).json().email).toBe('alice@example.com');
    expect((await me(b.token)).json().email).toBe('bob@example.com');
  });
});

describe('POST /api/logout', () => {
  const logout = (token, extra = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: token === undefined ? {} : { [SESSION.COOKIE_NAME]: token },
      ...extra,
    });

  test('trả 204, xóa phiên khỏi DB và xóa cookie', async () => {
    const { token } = await loginAs(await registerUser());
    const res = await logout(token);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(db.sessions.size).toBe(0);
    const cleared = res.cookies.find((c) => c.name === SESSION.COOKIE_NAME);
    expect(cleared.value).toBe('');
    expect(cleared.expires.getTime()).toBeLessThan(Date.now());
  });

  test('token cũ không dùng lại được sau khi đăng xuất (ASVS 7.4.1)', async () => {
    const { token } = await loginAs(await registerUser());
    await logout(token);
    expect((await me(token)).statusCode).toBe(401);
  });

  test('chỉ hủy phiên hiện tại, các phiên khác của cùng người dùng vẫn sống', async () => {
    const user = await registerUser();
    const laptop = await loginAs(user);
    const phone = await loginAs(user);

    await logout(laptop.token);

    expect((await me(laptop.token)).statusCode).toBe(401);
    expect((await me(phone.token)).statusCode).toBe(200);
  });

  test('không có cookie trả 401', async () => {
    const res = await logout(undefined);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  test('đăng xuất lần hai trả 401 chứ không phải lỗi 500', async () => {
    const { token } = await loginAs(await registerUser());
    await logout(token);
    const again = await logout(token);
    expect(again.statusCode).toBe(401);
  });

  test('từ chối request từ Origin lạ và không hủy phiên', async () => {
    const { token } = await loginAs(await registerUser());
    const res = await logout(token, { headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(db.sessions.size).toBe(1);
  });
});
