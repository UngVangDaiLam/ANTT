import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { KDF_DEFAULTS, RATE_LIMITS } from '@secure-notes/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hashAuthKey } from '../src/lib/auth-key.js';
import { createFakeDb } from './helpers/fake-db.js';
import { b64, registerBody, sealed } from './helpers/fixtures.js';

let app;
let db;
let ipCounter = 0;

/** Mỗi request một IP riêng để rate limit không ảnh hưởng các test khác. */
function register(payload, remoteAddress = `10.0.0.${++ipCounter % 250}`) {
  return app.inject({ method: 'POST', url: '/api/register', payload, remoteAddress });
}

beforeEach(async () => {
  db = createFakeDb();
  app = await buildApp({ config: loadConfig({}), db });
  await app.ready();
});

afterEach(() => app.close());

describe('POST /api/register', () => {
  test('đăng ký thành công trả 201, body rỗng', async () => {
    const res = await register(registerBody());
    expect(res.statusCode).toBe(201);
    expect(res.body).toBe('');
    expect(db.users.has('lam@example.com')).toBe(true);
  });

  test('lưu SHA-256(authKey), không lưu authKey gốc', async () => {
    const body = registerBody();
    await register(body);
    const stored = db.users.get('lam@example.com');
    expect(stored.authKeyHash.equals(hashAuthKey(body.authKey))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(body.authKey);
    expect(stored).not.toHaveProperty('authKey');
  });

  test('lưu đúng các trường còn lại và tách kdfParams thành cột', async () => {
    const body = registerBody();
    await register(body);
    const stored = db.users.get('lam@example.com');
    expect(stored).toMatchObject({
      salt: body.salt,
      kdfOpslimit: body.kdfParams.opslimit,
      kdfMemlimit: body.kdfParams.memlimit,
      wrappedVaultKey: body.wrappedVaultKey,
      x25519PublicKey: body.x25519PublicKey,
      ed25519PublicKey: body.ed25519PublicKey,
      wrappedX25519PrivateKey: body.wrappedX25519PrivateKey,
      wrappedEd25519PrivateKey: body.wrappedEd25519PrivateKey,
    });
  });

  test('chuẩn hóa email: bỏ khoảng trắng, chuyển chữ thường', async () => {
    await register(registerBody({ email: '  Lam@Example.COM ' }));
    expect([...db.users.keys()]).toEqual(['lam@example.com']);
  });

  test('email đã tồn tại trả 409 EMAIL_TAKEN', async () => {
    expect((await register(registerBody())).statusCode).toBe(201);
    const res = await register(registerBody());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'EMAIL_TAKEN', message: 'Email này đã được đăng ký.' });
  });

  test('email trùng nhưng khác hoa/thường, khoảng trắng vẫn bị coi là đã tồn tại', async () => {
    await register(registerBody());
    const res = await register(registerBody({ email: ' LAM@example.com' }));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('EMAIL_TAKEN');
  });

  test('email trùng không ghi đè dữ liệu của tài khoản cũ', async () => {
    const first = registerBody();
    await register(first);
    await register(registerBody());
    expect(db.users.get('lam@example.com').salt).toBe(first.salt);
  });

  test('thiếu trường bắt buộc trả VALIDATION_ERROR', async () => {
    const body = registerBody();
    delete body.authKey;
    const res = await register(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(db.users.size).toBe(0);
  });

  test('trường lạ bị từ chối (ví dụ isAdmin)', async () => {
    const res = await register(registerBody({ isAdmin: true }));
    expect(res.statusCode).toBe(400);
    expect(db.users.size).toBe(0);
  });

  test('trường lạ lồng bên trong Sealed cũng bị từ chối', async () => {
    const res = await register(registerBody({ wrappedVaultKey: { ...sealed(), extra: 'x' } }));
    expect(res.statusCode).toBe(400);
  });

  test.each([
    ['salt sai độ dài', { salt: b64(8) }],
    ['authKey sai độ dài', { authKey: b64(16) }],
    ['public key sai độ dài', { x25519PublicKey: b64(64) }],
    ['authKey có padding "="', { authKey: `${b64(32)}=` }],
    ['authKey chứa ký tự base64 thường (+/)', { authKey: `${'+/'.repeat(21)}A` }],
    ['email không có @', { email: 'khong-phai-email' }],
    ['kdfParams.memlimit quá nhỏ', { kdfParams: { opslimit: 3, memlimit: 1024 } }],
    ['kdfParams.opslimit = 0', { kdfParams: { opslimit: 0, memlimit: KDF_DEFAULTS.memlimit } }],
    ['kdfParams là số thực', { kdfParams: { opslimit: 2.5, memlimit: KDF_DEFAULTS.memlimit } }],
  ])('từ chối: %s', async (_name, overrides) => {
    const res = await register(registerBody(overrides));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(db.users.size).toBe(0);
  });

  test('từ chối JSON chứa __proto__', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(registerBody()).replace(/^\{/, '{"__proto__":{"isAdmin":true},'),
    });
    expect(res.statusCode).toBe(400);
    expect(db.users.size).toBe(0);
  });

  test('lỗi DB khác không bị báo nhầm thành EMAIL_TAKEN', async () => {
    db.user.create = async () => {
      throw new Error('mất kết nối');
    };
    const res = await register(registerBody());
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ.' });
  });

  test('vượt giới hạn tần suất trả 429 RATE_LIMITED', async () => {
    const ip = '192.0.2.1';
    for (let i = 0; i < RATE_LIMITS.REGISTER.max; i++) {
      await register(registerBody({ email: `u${i}@example.com` }), ip);
    }
    const res = await register(registerBody({ email: 'next@example.com' }), ip);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
    expect(db.users.has('next@example.com')).toBe(false);
  });
});
