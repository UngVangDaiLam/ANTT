const sodium = require('libsodium-wrappers-sumo');
const {
  generateKeyPair,
  generateSigningKeyPair,
  wrapPrivateKey,
  unwrapPrivateKey,
  wrapNoteKeyForRecipient,
  unwrapNoteKeyFromSender,
  publicKeyFingerprint,
} = require('../src/sharing');

beforeAll(async () => {
  await sodium.ready;
});

describe('sharing (hybrid X25519 + XChaCha20-Poly1305 + ky so Ed25519)', () => {
  test('A chia se note key cho B (co ky so), B giai ma ra dung key', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey);
    const unwrapped = await unwrapNoteKeyFromSender(wrapped, bob.privateKey, alice.publicKey);

    expect(sodium.to_base64(unwrapped)).toBe(sodium.to_base64(noteKey));
  });

  test('nguoi khac (khong phai B) khong giai ma duoc', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey);
    await expect(unwrapNoteKeyFromSender(wrapped, eve.privateKey, alice.publicKey)).rejects.toBeTruthy();
  });

  test('sai public key ky (khong phai cua A that) -> B phai tu choi, khong giai ma', async () => {
    const alice = await generateSigningKeyPair();
    const mallory = await generateSigningKeyPair(); // ke tan cong tu xung la A
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey);
    // B tuong nham public key ky cua Mallory la cua Alice -> phai bi tu choi
    await expect(
      unwrapNoteKeyFromSender(wrapped, bob.privateKey, mallory.publicKey)
    ).rejects.toThrow('Chu ky khong hop le');
  });

  test('goi tin bi sua doi tren duong truyen (vi du ciphertext bi doi) -> chu ky phai fail', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey);
    const tampered = { ...wrapped, ciphertext: wrapped.ciphertext.slice(0, -4) + 'AAAA' };

    await expect(
      unwrapNoteKeyFromSender(tampered, bob.privateKey, alice.publicKey)
    ).rejects.toThrow('Chu ky khong hop le');
  });

  test('private key cua user duoc boc/mo dung bang master key (dung chung cho ca ECDH lan ky so)', async () => {
    const masterKey = sodium.randombytes_buf(32);
    const alice = await generateKeyPair();
    const aliceSigning = await generateSigningKeyPair();

    const wrapped = await wrapPrivateKey(alice.privateKey, masterKey);
    const recovered = await unwrapPrivateKey(wrapped, masterKey);
    expect(sodium.to_base64(recovered)).toBe(sodium.to_base64(alice.privateKey));

    const wrappedSigning = await wrapPrivateKey(aliceSigning.privateKey, masterKey);
    const recoveredSigning = await unwrapPrivateKey(wrappedSigning, masterKey);
    expect(sodium.to_base64(recoveredSigning)).toBe(sodium.to_base64(aliceSigning.privateKey));
  });

  test('moi lan chia se dung ephemeral key va chu ky khac nhau (khong tai su dung)', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped1 = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey);
    const wrapped2 = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey);

    expect(wrapped1.ephemeralPublicKey).not.toBe(wrapped2.ephemeralPublicKey);
    expect(wrapped1.signature).not.toBe(wrapped2.signature);
  });

  test('publicKeyFingerprint la deterministic (goi nhieu lan ra cung 1 ket qua)', async () => {
    const alice = await generateKeyPair();
    const fp1 = publicKeyFingerprint(alice.publicKey);
    const fp2 = publicKeyFingerprint(alice.publicKey);
    expect(fp1).toBe(fp2);
  });

  test('publicKeyFingerprint phan biet duoc 2 khoa khac nhau', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    expect(publicKeyFingerprint(alice.publicKey)).not.toBe(publicKeyFingerprint(bob.publicKey));
  });
});