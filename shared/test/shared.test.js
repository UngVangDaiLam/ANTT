import { describe, expect, test } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  AppError,
  Base64UrlBytes,
  Email,
  IsoDateTime,
  NoteListItem,
  NoteResponse,
  NormalizedEmail,
  RegisterRequest,
  SaltResponse,
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
  test('NormalizedEmail từ chối email chưa chuẩn hóa (dùng cho response)', () => {
    expect(Value.Check(NormalizedEmail, 'lam@example.com')).toBe(true);
    expect(Value.Check(NormalizedEmail, ' lam@example.com ')).toBe(false);
  });

  test('IsoDateTime chỉ nhận mốc thời gian ISO-8601 UTC', () => {
    expect(Value.Check(IsoDateTime, new Date().toISOString())).toBe(true);
    expect(Value.Check(IsoDateTime, '20/09/2026')).toBe(false);
    expect(Value.Check(IsoDateTime, Date.now())).toBe(false);
  });

  test('SaltResponse: salt đúng 16 byte và luôn kèm kdfParams (D13)', () => {
    const salt = Buffer.alloc(16, 3).toString('base64url');
    const kdfParams = { opslimit: 3, memlimit: 64 * 1024 * 1024 };
    expect(Value.Check(SaltResponse, { salt, kdfParams })).toBe(true);
    // Thiếu kdfParams thì client sẽ đoán tham số Argon2id -> dẫn xuất sai khóa.
    expect(Value.Check(SaltResponse, { salt })).toBe(false);
    expect(Value.Check(SaltResponse, { salt: 'ngan-qua', kdfParams })).toBe(false);
  });

  test('NoteResponse: chủ note nhận wrappedNoteKey, người được chia sẻ nhận share (D22)', () => {
    const b = (n) => Buffer.alloc(n, 1).toString('base64url');
    const sealed = { nonce: b(24), ciphertext: b(48) };
    const base = {
      id: crypto.randomUUID(),
      version: 1,
      encryptedTitle: sealed,
      encryptedContent: sealed,
      updatedAt: new Date().toISOString(),
    };
    expect(Value.Check(NoteResponse, { ...base, wrappedNoteKey: sealed })).toBe(true);
    expect(
      Value.Check(NoteResponse, {
        ...base,
        share: {
          senderEmail: 'lam@example.com',
          sharePackage: {
            ephemeralPublicKey: b(32),
            nonce: b(24),
            ciphertext: b(48),
            signature: b(64),
          },
        },
      }),
    ).toBe(true);
    // Nội dung note KHÔNG bao giờ được trả dạng thô, dù server có cố gửi kèm.
    expect(Value.Check(NoteResponse, { ...base, wrappedNoteKey: sealed, plaintext: 'lo' })).toBe(
      false,
    );
    expect(Value.Check(NoteResponse, { ...base, wrappedNoteKey: sealed, version: 0 })).toBe(false);
  });

  test('NoteListItem có wrappedNoteKey nhưng KHÔNG có nội dung (D21, D41)', () => {
    const b = (n) => Buffer.alloc(n, 1).toString('base64url');
    const sealed = { nonce: b(24), ciphertext: b(48) };
    const item = {
      id: crypto.randomUUID(),
      version: 1,
      encryptedTitle: sealed,
      wrappedNoteKey: sealed,
      updatedAt: new Date().toISOString(),
    };
    expect(Value.Check(NoteListItem, item)).toBe(true);
    expect(Value.Check(NoteListItem, { ...item, encryptedContent: sealed })).toBe(false);
  });
});
