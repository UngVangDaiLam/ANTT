const sodium = require('libsodium-wrappers-sumo');
const { generateSalt, deriveKeysFromPassword } = require('../src/kdf');

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
});
