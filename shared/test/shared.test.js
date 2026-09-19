import { describe, expect, test } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  AppError,
  Base64UrlBytes,
  Email,
  RegisterRequest,
  Sealed,
  Uuid,
  normalizeEmail,
} from '../src/index.js';

describe('shared', () => {
  test('normalizeEmail bỏ khoảng trắng và chuyển chữ thường', () => {
    expect(normalizeEmail('  Lam@Example.COM ')).toBe('lam@example.com');
  });

  test('AppError trả đúng định dạng { code, message }', () => {
    const err = new AppError('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.toJSON()).toEqual({ code: 'NOT_FOUND', message: 'Không tìm thấy.' });
  });

  test('Sealed từ chối trường lạ và __proto__', () => {
    expect(Value.Check(Sealed, { nonce: 'abc', ciphertext: 'def' })).toBe(true);
    expect(Value.Check(Sealed, { nonce: 'abc', ciphertext: 'def', extra: 1 })).toBe(false);
    const polluted = JSON.parse('{"nonce":"a","ciphertext":"b","__proto__":{"x":1}}');
    expect(Value.Check(Sealed, polluted)).toBe(false);
  });

  test('Uuid chỉ nhận UUID v4 chữ thường', () => {
    expect(Value.Check(Uuid, crypto.randomUUID())).toBe(true);
    expect(Value.Check(Uuid, 'note-1')).toBe(false);
  });

  test('Base64UrlBytes chỉ nhận đúng số byte, không padding', () => {
    const key = Buffer.alloc(32, 7).toString('base64url');
    expect(Value.Check(Base64UrlBytes(32), key)).toBe(true);
    expect(Value.Check(Base64UrlBytes(32), `${key}=`)).toBe(false);
    expect(Value.Check(Base64UrlBytes(32), Buffer.alloc(16).toString('base64url'))).toBe(false);
  });

  test('Email cần có @, cho phép khoảng trắng hai đầu', () => {
    expect(Value.Check(Email, ' Lam@Example.com ')).toBe(true);
    expect(Value.Check(Email, 'khong-phai-email')).toBe(false);
    expect(Value.Check(Email, 'a b@x.com')).toBe(false);
  });

  test('RegisterRequest nhận body hợp lệ, từ chối trường lạ', () => {
    const b = (n) => Buffer.alloc(n, 1).toString('base64url');
    const sealed = { nonce: b(24), ciphertext: b(48) };
    const body = {
      email: 'lam@example.com',
      salt: b(16),
      kdfParams: { opslimit: 3, memlimit: 64 * 1024 * 1024 },
      authKey: b(32),
      wrappedVaultKey: sealed,
      x25519PublicKey: b(32),
      ed25519PublicKey: b(32),
      wrappedX25519PrivateKey: sealed,
      wrappedEd25519PrivateKey: sealed,
    };
    expect(Value.Check(RegisterRequest, body)).toBe(true);
    expect(Value.Check(RegisterRequest, { ...body, isAdmin: true })).toBe(false);
  });
});
