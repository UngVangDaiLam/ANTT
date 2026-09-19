import { expect, test } from 'vitest';
import { getSodium } from '../src/index.js';

test('libsodium-wrappers-sumo nạp được dưới dạng ESM và có Argon2id', async () => {
  const sodium = await getSodium();
  expect(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES).toBe(32);
  expect(typeof sodium.crypto_pwhash).toBe('function');
  expect(sodium.crypto_pwhash_ALG_ARGON2ID13).toBeDefined();
});
