import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { KDF_DEFAULTS, KDF_MAXIMUMS, KDF_MINIMUMS, RATE_LIMITS } from '@secure-notes/shared';
import { backends } from './helpers/backends.js';
import { b64, changePasswordBody, sealed } from './helpers/fixtures.js';
import { createHarness } from './helpers/harness.js';

describe.each(backends)('POST /api/change-password [$name]', (backend) => {
  let db;
  let h;
  let alice;

  beforeEach(async () => {
    db = await backend.create();
    h = await createHarness(db);
    alice = await h.signUp('alice@example.com');
  });

  afterEach(() => h.close());

  const change = (user, body, extra) => user.req('POST', '/api/change-password', body, extra);
  const salt = (email) =>
    h.send('GET', `/api/users/${encodeURIComponent(email)}/salt`).then((r) => r.json());

  test('đổi thành công trả 204; đăng nhập bằng authKey mới được, authKey cũ hết dùng', async () => {
    const body = changePasswordBody(alice.authKey);

    const res = await change(alice, body);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const withNew = await h.send('POST', '/api/login', {
      payload: { email: alice.email, authKey: body.authKey },
    });
    const withOld = await h.send('POST', '/api/login', {
      payload: { email: alice.email, authKey: alice.authKey },
    });
    expect(withNew.statusCode).toBe(200);
    expect(withOld.statusCode).toBe(401);
    expect(withOld.json().code).toBe('INVALID_CREDENTIALS');
  });

  test('salt, kdfParams và các khóa đã bọc được thay bằng bản mới', async () => {
    const body = changePasswordBody(alice.authKey, {
      kdfParams: { opslimit: 4, memlimit: 128 * 1024 * 1024 },
    });

    await change(alice, body);

    expect(await salt(alice.email)).toEqual({ salt: body.salt, kdfParams: body.kdfParams });
    const account = (await alice.req('GET', '/api/me')).json();
    expect(account.wrappedVaultKey).toEqual(body.wrappedVaultKey);
    expect(account.wrappedX25519PrivateKey).toEqual(body.wrappedX25519PrivateKey);
    expect(account.wrappedEd25519PrivateKey).toEqual(body.wrappedEd25519PrivateKey);
    // Khóa công khai là của người dùng, không đổi khi đổi mật khẩu.
    expect(account.x25519PublicKey).toBe(alice.body.x25519PublicKey);
    expect(account.ed25519PublicKey).toBe(alice.body.ed25519PublicKey);
  });

  test('phiên hiện tại được giữ, mọi phiên khác của người này bị hủy (D25)', async () => {
    const laptop = alice.token;
    const phone = await alice.newSession();
    const tablet = await alice.newSession();

    const res = await change(alice, changePasswordBody(alice.authKey));

    expect(res.statusCode).toBe(204);
    const alive = (token) => h.send('GET', '/api/me', { token }).then((r) => r.statusCode);
    expect(await alive(laptop)).toBe(200);
    expect(await alive(phone)).toBe(401);
    expect(await alive(tablet)).toBe(401);
  });

  test('không đụng tới phiên của người dùng khác', async () => {
    const bob = await h.signUp('bob@example.com');
    await change(alice, changePasswordBody(alice.authKey));
    expect((await bob.req('GET', '/api/me')).statusCode).toBe(200);
  });

  test('note và chia sẻ nguyên vẹn sau khi đổi mật khẩu', async () => {
    const bob = await h.signUp('bob@example.com');
    const note = { id: crypto.randomUUID(), version: 1 };
    await alice.req('POST', '/api/notes', {
      ...note,
      encryptedTitle: sealed(),
      encryptedContent: sealed(),
      wrappedNoteKey: sealed(),
    });
    await alice.req('POST', `/api/notes/${note.id}/shares`, {
      recipientEmail: bob.email,
      sharePackage: {
        ephemeralPublicKey: b64(32),
        nonce: b64(24),
        ciphertext: b64(48),
        signature: b64(64),
      },
    });

    await change(alice, changePasswordBody(alice.authKey));

    expect((await alice.req('GET', `/api/notes/${note.id}`)).statusCode).toBe(200);
    expect((await bob.req('GET', `/api/notes/${note.id}`)).statusCode).toBe(200);
  });

  test('sai oldAuthKey trả 401 INVALID_CREDENTIALS và KHÔNG đổi gì cả', async () => {
    const phone = await alice.newSession();
    const before = await salt(alice.email);

    const res = await change(alice, changePasswordBody(b64(32)));

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
    // Mật khẩu cũ vẫn dùng được, salt không đổi, phiên khác không bị hủy.
    expect(await salt(alice.email)).toEqual(before);
    expect(
      (
        await h.send('POST', '/api/login', {
          payload: { email: alice.email, authKey: alice.authKey },
        })
      ).statusCode,
    ).toBe(200);
    expect((await h.send('GET', '/api/me', { token: phone })).statusCode).toBe(200);
  });

  test('chỉ có cookie phiên là chưa đủ: người mượn được tab đang đăng nhập không đổi được', async () => {
    // Kẻ có cookie nhưng không biết mật khẩu: không có oldAuthKey đúng.
    const res = await change(alice, changePasswordBody(b64(32)));
    expect(res.statusCode).toBe(401);
  });

  test('hai yêu cầu đổi đồng thời với cùng oldAuthKey: đúng một bên thắng', async () => {
    const first = changePasswordBody(alice.authKey);
    const second = changePasswordBody(alice.authKey);

    const results = await Promise.all([change(alice, first), change(alice, second)]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 401]);
    // Chỉ authKey của bên thắng dùng được: bên thua không ghi đè lên.
    const winner = results[0].statusCode === 204 ? first : second;
    const loser = winner === first ? second : first;
    const login = (authKey) =>
      h
        .send('POST', '/api/login', { payload: { email: alice.email, authKey } })
        .then((r) => r.statusCode);
    expect(await login(winner.authKey)).toBe(200);
    expect(await login(loser.authKey)).toBe(401);
  });

  // Ép cuộc đua thật sự xảy ra: cả hai yêu cầu đều đọc hash CŨ trước khi yêu cầu nào kịp ghi. Không
  // có rào chắn này thì yêu cầu thứ hai thường đọc SAU khi yêu cầu đầu đã ghi và bị chặn ở bước
  // kiểm tra trước, nên không bao giờ chạm tới điều kiện `authKeyHash` trong câu UPDATE.
  // Chỉ chạy được trên DB giả (chèn được vào lời gọi); trên PostgreSQL thật, điều kiện này là
  // ngữ nghĩa chuẩn của `UPDATE ... WHERE`.
  test.runIf(backend.name === 'fake')(
    'cuộc đua bị ép xảy ra: điều kiện authKeyHash trong câu UPDATE chặn bên thua ghi đè',
    async () => {
      const original = db.user.findUnique;
      let arrived = 0;
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      db.user.findUnique = async (args) => {
        const result = await original(args);
        if (args.select?.authKeyHash) {
          arrived += 1;
          if (arrived === 2) release();
          await gate; // đợi tới khi cả hai yêu cầu đã đọc xong hash cũ
        }
        return result;
      };
      const first = changePasswordBody(alice.authKey);
      const second = changePasswordBody(alice.authKey);

      const results = await Promise.all([change(alice, first), change(alice, second)]);

      expect(arrived).toBe(2);
      expect(results.map((r) => r.statusCode).sort()).toEqual([204, 401]);
      const winner = results[0].statusCode === 204 ? first : second;
      const loser = winner === first ? second : first;
      const login = (authKey) =>
        h
          .send('POST', '/api/login', { payload: { email: alice.email, authKey } })
          .then((r) => r.statusCode);
      expect(await login(winner.authKey)).toBe(200);
      expect(await login(loser.authKey)).toBe(401);
    },
  );

  test.each([
    [
      'opslimit dưới sàn',
      { kdfParams: { opslimit: KDF_MINIMUMS.opslimit - 1, memlimit: KDF_DEFAULTS.memlimit } },
    ],
    [
      'memlimit dưới sàn',
      { kdfParams: { opslimit: KDF_DEFAULTS.opslimit, memlimit: KDF_MINIMUMS.memlimit - 1 } },
    ],
    [
      'opslimit vượt trần',
      { kdfParams: { opslimit: KDF_MAXIMUMS.opslimit + 1, memlimit: KDF_DEFAULTS.memlimit } },
    ],
    [
      'memlimit vượt trần',
      { kdfParams: { opslimit: KDF_DEFAULTS.opslimit, memlimit: KDF_MAXIMUMS.memlimit + 1 } },
    ],
    ['authKey sai độ dài', { authKey: b64(16) }],
    ['salt sai độ dài', { salt: b64(8) }],
    ['oldAuthKey sai độ dài', { oldAuthKey: b64(16) }],
    ['trường lạ', { isAdmin: true }],
  ])('%s bị từ chối và không đổi gì', async (_name, overrides) => {
    const res = await change(alice, changePasswordBody(alice.authKey, overrides));

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(
      (
        await h.send('POST', '/api/login', {
          payload: { email: alice.email, authKey: alice.authKey },
        })
      ).statusCode,
    ).toBe(200);
  });

  test('thiếu khóa đã bọc bị từ chối (không thể đổi mật khẩu mà bỏ mất private key)', async () => {
    const body = changePasswordBody(alice.authKey);
    delete body.wrappedEd25519PrivateKey;
    expect((await change(alice, body)).statusCode).toBe(400);
  });

  test('vượt giới hạn tần suất trả 429, kể cả khi lần sau dùng đúng oldAuthKey', async () => {
    const ip = '192.0.2.60';
    for (let i = 0; i < RATE_LIMITS.CHANGE_PASSWORD.max; i++) {
      await change(alice, changePasswordBody(b64(32)), { ip });
    }

    const res = await change(alice, changePasswordBody(alice.authKey), { ip });

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
    // Mật khẩu cũ vẫn nguyên vì yêu cầu đúng bị chặn trước khi chạy.
    expect(
      (
        await h.send('POST', '/api/login', {
          payload: { email: alice.email, authKey: alice.authKey },
        })
      ).statusCode,
    ).toBe(200);
  });

  test('từ chối request từ Origin lạ (CSRF) và không đổi gì', async () => {
    const res = await change(alice, changePasswordBody(alice.authKey), {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(
      (
        await h.send('POST', '/api/login', {
          payload: { email: alice.email, authKey: alice.authKey },
        })
      ).statusCode,
    ).toBe(200);
  });
});
