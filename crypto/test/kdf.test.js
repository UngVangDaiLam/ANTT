import { describe, test, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers-sumo';
import { generateSalt, deriveKeysFromPassword } from '../src/kdf.js';

beforeAll(async () => {
  await sodium.ready;
});

describe('kdf', () => {
  test('cung password + salt cho ra cung khoa (deterministic)', async () => {
    const salt = generateSalt();
    const keys1 = await deriveKeysFromPassword('MatKhauManh123!', salt);
    const keys2 = await deriveKeysFromPassword('MatKhauManh123!', salt);
    expect(sodium.to_base64(keys1.authKey)).toBe(sodium.to_base64(keys2.authKey));
    expect(sodium.to_base64(keys1.masterKey)).toBe(sodium.to_base64(keys2.masterKey));
  });

  test('authKey va masterKey phai khac nhau (tach dung)', async () => {
    const salt = generateSalt();
    const { authKey, masterKey } = await deriveKeysFromPassword('MatKhauManh123!', salt);
    expect(sodium.to_base64(authKey)).not.toBe(sodium.to_base64(masterKey));
  });

  test('salt khac nhau -> khoa khac nhau du cung password', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const keys1 = await deriveKeysFromPassword('MatKhauManh123!', salt1);
    const keys2 = await deriveKeysFromPassword('MatKhauManh123!', salt2);
    expect(sodium.to_base64(keys1.masterKey)).not.toBe(sodium.to_base64(keys2.masterKey));
  });

  test('password khac nhau -> khoa khac nhau du cung salt', async () => {
    const salt = generateSalt();
    const keys1 = await deriveKeysFromPassword('MatKhauManh123!', salt);
    const keys2 = await deriveKeysFromPassword('MatKhauKhac456!', salt);
    expect(sodium.to_base64(keys1.masterKey)).not.toBe(sodium.to_base64(keys2.masterKey));
  });

  test('kdfParams tuy chinh (opslimit/memlimit khac mac dinh) van deterministic', async () => {
    const salt = generateSalt();
    const customParams = { opslimit: 2, memlimit: 32 * 1024 * 1024 };
    const keys1 = await deriveKeysFromPassword('MatKhauManh123!', salt, customParams);
    const keys2 = await deriveKeysFromPassword('MatKhauManh123!', salt, customParams);
    expect(sodium.to_base64(keys1.masterKey)).toBe(sodium.to_base64(keys2.masterKey));
  });

  test('kdfParams khac nhau -> khoa khac nhau du cung password + salt (vi sao phai luu kdfParams tung tai khoan)', async () => {
    const salt = generateSalt();
    const keysDefault = await deriveKeysFromPassword('MatKhauManh123!', salt);
    const keysCustom = await deriveKeysFromPassword('MatKhauManh123!', salt, {
      opslimit: 4,
      memlimit: 128 * 1024 * 1024,
    });
    expect(sodium.to_base64(keysDefault.masterKey)).not.toBe(sodium.to_base64(keysCustom.masterKey));
  });
});
