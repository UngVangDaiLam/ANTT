import { describe, expect, test } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  AppError,
  Base64UrlBytes,
  Email,
  IsoDateTime,
  KDF_DEFAULTS,
  KDF_MAXIMUMS,
  KDF_MINIMUMS,
  KdfParams,
  LIMITS,
  NoteCreateRequest,
  NoteListItem,
  NoteResponse,
  NormalizedEmail,
  RegisterRequest,
  RotateRequest,
  SaltResponse,
  Sealed,
  SealedBounded,
  SharePackage,
  Uuid,
  normalizeEmail,
  sealedCiphertextMaxLength,
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
    const ok = { nonce: Buffer.alloc(24, 1).toString('base64url'), ciphertext: 'A'.repeat(64) };
    expect(Value.Check(Sealed, ok)).toBe(true);
    expect(Value.Check(Sealed, { ...ok, extra: 1 })).toBe(false);
    const polluted = JSON.parse(
      `{"nonce":"${ok.nonce}","ciphertext":"${ok.ciphertext}","__proto__":{"x":1}}`,
    );
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

  test('sealedCiphertextMaxLength khớp độ dài base64url thực của libsodium', () => {
    // ciphertext = bản rõ + 16 byte tag; base64url không padding dài ceil(n * 4 / 3) ký tự.
    for (const plaintextBytes of [0, 1, 2, 3, 32, 1024]) {
      const real = Buffer.alloc(plaintextBytes + 16, 7).toString('base64url');
      expect(sealedCiphertextMaxLength(plaintextBytes)).toBe(real.length);
    }
  });

  test('SealedBounded: nonce đúng 24 byte, ciphertext có tag và không vượt trần', () => {
    const schema = SealedBounded(32);
    const nonce = Buffer.alloc(24, 1).toString('base64url');
    const at = (n) => ({ nonce, ciphertext: 'A'.repeat(n) });
    const max = sealedCiphertextMaxLength(32);

    expect(Value.Check(schema, at(max))).toBe(true);
    expect(Value.Check(schema, at(max + 1))).toBe(false); // vượt trần
    expect(Value.Check(schema, at(21))).toBe(false); // ngắn hơn một tag 16 byte
    expect(Value.Check(schema, { ...at(max), nonce: Buffer.alloc(12).toString('base64url') })).toBe(
      false,
    );
    expect(Value.Check(schema, { ...at(max), nonce: `${nonce}=` })).toBe(false); // có padding
  });

  test('KdfParams có sàn và trần: chặn tham số yếu lẫn tham số khổng lồ', () => {
    const ok = { ...KDF_DEFAULTS };
    expect(Value.Check(KdfParams, ok)).toBe(true);
    expect(Value.Check(KdfParams, KDF_MINIMUMS)).toBe(true);
    expect(Value.Check(KdfParams, KDF_MAXIMUMS)).toBe(true);
    expect(Value.Check(KdfParams, { ...ok, opslimit: KDF_MINIMUMS.opslimit - 1 })).toBe(false);
    expect(Value.Check(KdfParams, { ...ok, memlimit: KDF_MINIMUMS.memlimit - 1 })).toBe(false);
    expect(Value.Check(KdfParams, { ...ok, opslimit: KDF_MAXIMUMS.opslimit + 1 })).toBe(false);
    expect(Value.Check(KdfParams, { ...ok, memlimit: KDF_MAXIMUMS.memlimit + 1 })).toBe(false);
    expect(Value.Check(KdfParams, { ...ok, opslimit: 2.5 })).toBe(false);
  });

  test('SaltResponse từ chối tham số Argon2id yếu: server độc hại không hạ cấp được client', () => {
    const salt = Buffer.alloc(16, 3).toString('base64url');
    const weak = { opslimit: 1, memlimit: 8192 };
    expect(Value.Check(SaltResponse, { salt, kdfParams: weak })).toBe(false);
    expect(Value.Check(SaltResponse, { salt, kdfParams: KDF_DEFAULTS })).toBe(true);
  });

  test('mặc định KDF_DEFAULTS luôn nằm trong [sàn, trần]', () => {
    expect(KDF_DEFAULTS.opslimit).toBeGreaterThanOrEqual(KDF_MINIMUMS.opslimit);
    expect(KDF_DEFAULTS.memlimit).toBeGreaterThanOrEqual(KDF_MINIMUMS.memlimit);
    expect(KDF_DEFAULTS.opslimit).toBeLessThanOrEqual(KDF_MAXIMUMS.opslimit);
    expect(KDF_DEFAULTS.memlimit).toBeLessThanOrEqual(KDF_MAXIMUMS.memlimit);
  });

  test('SharePackage kiểm tra độ dài chính xác của từng thành phần', () => {
    const b = (n) => Buffer.alloc(n, 1).toString('base64url');
    const pkg = {
      ephemeralPublicKey: b(32),
      nonce: b(24),
      ciphertext: b(48),
      signature: b(64),
    };
    expect(Value.Check(SharePackage, pkg)).toBe(true);
    expect(Value.Check(SharePackage, { ...pkg, signature: b(32) })).toBe(false);
    expect(Value.Check(SharePackage, { ...pkg, ephemeralPublicKey: b(16) })).toBe(false);
    expect(Value.Check(SharePackage, { ...pkg, nonce: b(12) })).toBe(false);
  });

  test('NoteCreateRequest: version phải là 1, tiêu đề bị chặn trần riêng', () => {
    const b = (n) => Buffer.alloc(n, 1).toString('base64url');
    const sealed = { nonce: b(24), ciphertext: b(48) };
    const body = {
      id: crypto.randomUUID(),
      version: 1,
      encryptedTitle: sealed,
      encryptedContent: sealed,
      wrappedNoteKey: sealed,
    };
    const longTitle = {
      nonce: b(24),
      ciphertext: 'A'.repeat(sealedCiphertextMaxLength(LIMITS.MAX_NOTE_TITLE_BYTES) + 1),
    };
    expect(Value.Check(NoteCreateRequest, body)).toBe(true);
    expect(Value.Check(NoteCreateRequest, { ...body, version: 2 })).toBe(false);
    expect(Value.Check(NoteCreateRequest, { ...body, encryptedTitle: longTitle })).toBe(false);
    expect(Value.Check(NoteCreateRequest, { ...body, ownerId: 'x' })).toBe(false);
  });

  test('RotateRequest: giới hạn số người nhận và từ chối trường lạ', () => {
    const b = (n) => Buffer.alloc(n, 1).toString('base64url');
    const sealed = { nonce: b(24), ciphertext: b(48) };
    const entry = (i) => ({
      recipientEmail: `u${i}@example.com`,
      sharePackage: {
        ephemeralPublicKey: b(32),
        nonce: b(24),
        ciphertext: b(48),
        signature: b(64),
      },
    });
    const body = (n) => ({
      version: 2,
      encryptedTitle: sealed,
      encryptedContent: sealed,
      wrappedNoteKey: sealed,
      shares: Array.from({ length: n }, (_, i) => entry(i)),
    });

    expect(Value.Check(RotateRequest, body(0))).toBe(true);
    expect(Value.Check(RotateRequest, body(LIMITS.MAX_ROTATE_SHARES))).toBe(true);
    expect(Value.Check(RotateRequest, body(LIMITS.MAX_ROTATE_SHARES + 1))).toBe(false);
    expect(Value.Check(RotateRequest, { ...body(1), version: 1 })).toBe(false);
    expect(Value.Check(RotateRequest, { ...body(1), extra: true })).toBe(false);
  });
});
