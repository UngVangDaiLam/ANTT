import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { hashAuthKey, verifyAuthKey } from '../src/lib/auth-key.js';
import { CRYPTO_SIZES } from '@secure-notes/shared';
import { fakeSaltFor } from '../src/lib/fake-salt.js';

describe('auth-key', () => {
  test('xác minh đúng authKey, từ chối authKey sai', () => {
    const key = randomBytes(32).toString('base64url');
    const other = randomBytes(32).toString('base64url');
    const stored = hashAuthKey(key);
    expect(verifyAuthKey(key, stored)).toBe(true);
    expect(verifyAuthKey(other, stored)).toBe(false);
  });
});

describe('fake-salt', () => {
  test('cùng email cho cùng salt giả, đúng độ dài, dạng base64url không padding', () => {
    const a = fakeSaltFor('ai@example.com', 'secret');
    expect(a).toBe(fakeSaltFor('ai@example.com', 'secret'));
    expect(Buffer.from(a, 'base64url')).toHaveLength(CRYPTO_SIZES.SALT_BYTES);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('email khác hoặc secret khác cho salt khác', () => {
    expect(fakeSaltFor('a@x.com', 's')).not.toBe(fakeSaltFor('b@x.com', 's'));
    expect(fakeSaltFor('a@x.com', 's1')).not.toBe(fakeSaltFor('a@x.com', 's2'));
  });
});
