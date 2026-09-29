import { describe, test, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers-sumo';
import { generateVaultKey, wrapVaultKey, unwrapVaultKey } from '../src/vault.js';

beforeAll(async () => {
  await sodium.ready;
});

function flipOneChar(base64Str) {
  const chars = base64Str.split('');
  const idx = Math.floor(chars.length / 2);
  chars[idx] = chars[idx] === 'A' ? 'B' : 'A';
  return chars.join('');
}

describe('vault (key wrapping 2 lop)', () => {
  test('wrap roi unwrap phai ra dung vault key ban dau', async () => {
    const masterKey = sodium.randombytes_buf(32);
    const vaultKey = generateVaultKey();
    const wrapped = await wrapVaultKey(vaultKey, masterKey);
    const unwrapped = await unwrapVaultKey(wrapped, masterKey);
    expect(sodium.to_base64(unwrapped)).toBe(sodium.to_base64(vaultKey));
  });

  test('sai master key -> unwrap phai that bai', async () => {
    const masterKey = sodium.randombytes_buf(32);
    const wrongKey = sodium.randombytes_buf(32);
    const vaultKey = generateVaultKey();
    const wrapped = await wrapVaultKey(vaultKey, masterKey);
    await expect(unwrapVaultKey(wrapped, wrongKey)).rejects.toBeTruthy();
  });

  test('sua 1 ky tu trong ciphertext -> unwrap phai that bai (chung minh tinh toan ven AEAD)', async () => {
    const masterKey = sodium.randombytes_buf(32);
    const vaultKey = generateVaultKey();
    const wrapped = await wrapVaultKey(vaultKey, masterKey);
    const tampered = { ...wrapped, ciphertext: flipOneChar(wrapped.ciphertext) };
    await expect(unwrapVaultKey(tampered, masterKey)).rejects.toBeTruthy();
  });

  test('doi mat khau = chi can wrap lai vault key, khong dung den note nao', async () => {
    const oldMasterKey = sodium.randombytes_buf(32);
    const newMasterKey = sodium.randombytes_buf(32);
    const vaultKey = generateVaultKey();

    const wrappedOld = await wrapVaultKey(vaultKey, oldMasterKey);
    const recovered = await unwrapVaultKey(wrappedOld, oldMasterKey);
    const wrappedNew = await wrapVaultKey(recovered, newMasterKey);
    const finalVaultKey = await unwrapVaultKey(wrappedNew, newMasterKey);

    expect(sodium.to_base64(finalVaultKey)).toBe(sodium.to_base64(vaultKey));
  });
});
