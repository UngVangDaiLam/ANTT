import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ACCOUNT_THROTTLE, AUTH_ATTEMPT_KINDS, RATE_LIMITS, SESSION } from '@secure-notes/shared';
import { backends } from './helpers/backends.js';
import { b64, noteBody, registerBody, sharePackage } from './helpers/fixtures.js';
import { createHarness } from './helpers/harness.js';

describe.each(backends)('POST /api/account/delete [$name]', (backend) => {
  let db;
  let h;
  let alice;
  let bob;

  beforeEach(async () => {
    db = await backend.create();
    h = await createHarness(db);
    alice = await h.signUp('alice@example.com');
    bob = await h.signUp('bob@example.com');
  });

  afterEach(() => h.close());

  const remove = (user, body, extra) => user.req('POST', '/api/account/delete', body, extra);
  const alive = (token) => h.send('GET', '/api/me', { token }).then((r) => r.statusCode);
  const saltOf = (email) =>
    h.send('POST', '/api/users/salt', { payload: { email } }).then((r) => r.json().salt);

  async function createNote(user) {
    const body = noteBody();
    const res = await user.req('POST', '/api/notes', body);
    expect(res.statusCode).toBe(201);
    return body.id;
  }

  async function share(from, noteId, recipientEmail) {
    const res = await from.req('POST', `/api/notes/${noteId}/shares`, {
      recipientEmail,
      sharePackage: sharePackage(),
    });
    expect(res.statusCode).toBe(201);
  }

  test('xóa thành công: 204, xóa cookie, mọi phiên hết hiệu lực, không đăng nhập lại được', async () => {
    const phone = await alice.newSession();

    const res = await remove(alice, { authKey: alice.authKey });

    expect(res.statusCode).toBe(204);
    const cleared = res.cookies.find((c) => c.name === SESSION.COOKIE_NAME);
    expect(cleared.value).toBe('');
    expect(await alive(alice.token)).toBe(401);
    expect(await alive(phone)).toBe(401);
    const login = await h.send('POST', '/api/login', {
      payload: { email: alice.email, authKey: alice.authKey },
    });
    expect(login.statusCode).toBe(401);
  });

  test('note của mình bị xóa, người được chia sẻ không còn đọc được', async () => {
    const noteId = await createNote(alice);
    await share(alice, noteId, bob.email);

    await remove(alice, { authKey: alice.authKey });

    expect((await bob.req('GET', `/api/notes/${noteId}`)).statusCode).toBe(404);
    expect((await bob.req('GET', '/api/shares')).json()).toEqual([]);
  });

  test('lượt chia sẻ người khác gửi cho mình bị gỡ; note của người khác còn nguyên', async () => {
    const bobNote = await createNote(bob);
    await share(bob, bobNote, alice.email);

    await remove(alice, { authKey: alice.authKey });

    expect((await bob.req('GET', `/api/notes/${bobNote}/shares`)).json()).toEqual([]);
    expect((await bob.req('GET', `/api/notes/${bobNote}`)).statusCode).toBe(200);
    expect(await alive(bob.token)).toBe(200);
  });

  test('lịch sử đăng nhập (email, IP, thiết bị) bị xóa cùng tài khoản', async () => {
    await h.send('POST', '/api/login', { payload: { email: alice.email, authKey: b64(32) } });
    // Lần thử với email này TRƯỚC khi tài khoản được tạo: userId null, chỉ nhận ra qua email.
    await db.loginHistory.create({
      data: { userId: null, emailAttempted: alice.email, success: false },
    });

    await remove(alice, { authKey: alice.authKey });

    const left = await db.loginHistory.findMany({
      where: { emailAttempted: alice.email },
      select: { id: true },
    });
    expect(left).toEqual([]);
  });

  test('sau khi xóa, email trở thành "chưa đăng ký": salt khác hẳn và đăng ký lại được (D15)', async () => {
    const oldSalt = await saltOf(alice.email);

    await remove(alice, { authKey: alice.authKey });

    expect(await saltOf(alice.email)).not.toBe(oldSalt);
    const again = await h.send('POST', '/api/register', {
      payload: registerBody({ email: alice.email }),
    });
    expect(again.statusCode).toBe(201);
  });

  test('sai mật khẩu: 401, không xóa gì, lần thử được ghi vào lịch sử', async () => {
    const noteId = await createNote(alice);

    const res = await remove(alice, { authKey: b64(32) });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
    expect(await alive(alice.token)).toBe(200);
    expect((await alice.req('GET', `/api/notes/${noteId}`)).statusCode).toBe(200);
    const [latest] = (await alice.req('GET', '/api/login-history')).json();
    expect(latest).toMatchObject({ kind: AUTH_ATTEMPT_KINDS.DELETE_ACCOUNT, success: false });
  });

  test('thiếu authKey hoặc thêm trường lạ: 400, cookie phiên thôi là chưa đủ', async () => {
    expect((await remove(alice, {})).statusCode).toBe(400);
    expect((await remove(alice, { authKey: alice.authKey, userId: 'x' })).statusCode).toBe(400);
    expect(await alive(alice.token)).toBe(200);
  });

  test('chưa đăng nhập: 401, và không xóa được tài khoản người khác dù biết mật khẩu của họ', async () => {
    const res = await h.send('POST', '/api/account/delete', {
      payload: { authKey: alice.authKey },
    });
    expect(res.statusCode).toBe(401);

    // Người xóa luôn là chủ phiên (D16): Bob gửi authKey của Alice thì chỉ bị coi là sai mật khẩu.
    const cross = await remove(bob, { authKey: alice.authKey });
    expect(cross.statusCode).toBe(401);
    expect(await alive(alice.token)).toBe(200);
    expect(await alive(bob.token)).toBe(200);
  });

  test('đang bị giới hạn theo tài khoản (D81): kể cả đúng mật khẩu cũng bị chặn', async () => {
    for (let i = 0; i < ACCOUNT_THROTTLE.FREE_FAILURES; i++) {
      await h.send('POST', '/api/login', { payload: { email: alice.email, authKey: b64(32) } });
    }

    const res = await remove(alice, { authKey: alice.authKey });

    expect(res.statusCode).toBe(429);
    expect(await alive(alice.token)).toBe(200);
  });

  test('vượt giới hạn tần suất theo IP: 429', async () => {
    const ip = '192.0.2.80';
    for (let i = 0; i < RATE_LIMITS.DELETE_ACCOUNT.max; i++) {
      await remove(bob, { authKey: b64(32) }, { ip });
    }
    // Đổi tài khoản để chắc là giới hạn theo IP chứ không phải theo tài khoản.
    const res = await remove(alice, { authKey: alice.authKey }, { ip });
    expect(res.statusCode).toBe(429);
    expect(await alive(alice.token)).toBe(200);
  });
});
