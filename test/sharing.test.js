const sodium = require('libsodium-wrappers-sumo');
const {
  generateKeyPair,
  wrapPrivateKey,
  unwrapPrivateKey,
  wrapNoteKeyForRecipient,
  unwrapNoteKeyFromSender,
  publicKeyFingerprint,
} = require('../src/sharing');

beforeAll(async () => {
  await sodium.ready;
});

describe('sharing (hybrid X25519 + XChaCha20-Poly1305)', () => {
  test('A chia se note key cho B, B giai ma ra dung key', async () => {
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey);
    const unwrapped = await unwrapNoteKeyFromSender(wrapped, bob.privateKey);

    expect(sodium.to_base64(unwrapped)).toBe(sodium.to_base64(noteKey));
  });

  test('nguoi khac (khong phai B) khong giai ma duoc', async () => {
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey);
    await expect(unwrapNoteKeyFromSender(wrapped, eve.privateKey)).rejects.toBeTruthy();
  });

  test('private key cua user duoc boc/mo dung bang master key', async () => {
    const masterKey = sodium.randombytes_buf(32);
    const alice = await generateKeyPair();

    const wrapped = await wrapPrivateKey(alice.privateKey, masterKey);
    const recovered = await unwrapPrivateKey(wrapped, masterKey);

    expect(sodium.to_base64(recovered)).toBe(sodium.to_base64(alice.privateKey));
  });

  test('moi lan chia se dung ephemeral key khac nhau (khong tai su dung)', async () => {
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped1 = await wrapNoteKeyForRecipient(noteKey, bob.publicKey);
    const wrapped2 = await wrapNoteKeyForRecipient(noteKey, bob.publicKey);

    expect(wrapped1.ephemeralPublicKey).not.toBe(wrapped2.ephemeralPublicKey);
  });

    test('publicKeyFingerprint cho cùng một public key phải ra cùng kết quả (deterministic)', async () => {
    const alice = await generateKeyPair();
    const fp1 = publicKeyFingerprint(alice.publicKey);
    const fp2 = publicKeyFingerprint(alice.publicKey);
    expect(fp1).toBe(fp2);
  });

  test('publicKeyFingerprint của 2 public key khác nhau phải cho kết quả khác nhau', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const fpAlice = publicKeyFingerprint(alice.publicKey);
    const fpBob = publicKeyFingerprint(bob.publicKey);
    expect(fpAlice).not.toBe(fpBob);
  });
  
});
