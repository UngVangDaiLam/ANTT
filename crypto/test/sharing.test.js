import { describe, test, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers-sumo';
import {
  generateKeyPair,
  generateSigningKeyPair,
  wrapPrivateKey,
  unwrapPrivateKey,
  wrapNoteKeyForRecipient,
  unwrapNoteKeyFromSender,
  publicKeyFingerprint,
} from '../src/sharing.js';

beforeAll(async () => {
  await sodium.ready;
});

const NOTE_A = '3f2b8c1e-7a4d-4e6f-9b1a-2c5d8e0f4a6b';
const NOTE_B = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

describe('sharing (hybrid X25519 + XChaCha20-Poly1305 + ky so Ed25519)', () => {
  test('A chia se note key cho B (co ky so), B giai ma ra dung key', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey, NOTE_A);
    const unwrapped = await unwrapNoteKeyFromSender(
      wrapped,
      bob.privateKey,
      alice.publicKey,
      NOTE_A,
    );

    expect(sodium.to_base64(unwrapped)).toBe(sodium.to_base64(noteKey));
  });

  test('nguoi khac (khong phai B) khong giai ma duoc', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey, NOTE_A);
    await expect(
      unwrapNoteKeyFromSender(wrapped, eve.privateKey, alice.publicKey, NOTE_A),
    ).rejects.toBeTruthy();
  });

  test('sai public key ky (khong phai cua A that) -> B phai tu choi, khong giai ma', async () => {
    const alice = await generateSigningKeyPair();
    const mallory = await generateSigningKeyPair(); // ke tan cong tu xung la A
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey, NOTE_A);
    await expect(
      unwrapNoteKeyFromSender(wrapped, bob.privateKey, mallory.publicKey, NOTE_A),
    ).rejects.toThrow('Chu ky khong hop le');
  });

  test('goi tin bi sua doi tren duong truyen (vi du ciphertext bi doi) -> chu ky phai fail', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey, NOTE_A);
    const tampered = { ...wrapped, ciphertext: wrapped.ciphertext.slice(0, -4) + 'AAAA' };

    await expect(
      unwrapNoteKeyFromSender(tampered, bob.privateKey, alice.publicKey, NOTE_A),
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

    const wrapped1 = await wrapNoteKeyForRecipient(
      noteKey,
      bob.publicKey,
      alice.privateKey,
      NOTE_A,
    );
    const wrapped2 = await wrapNoteKeyForRecipient(
      noteKey,
      bob.publicKey,
      alice.privateKey,
      NOTE_A,
    );

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

  test('goi chia se cua note A dem gan sang note B -> chu ky phai fail, khong giai ma (D23)', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);

    const forA = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey, NOTE_A);

    await expect(
      unwrapNoteKeyFromSender(forA, bob.privateKey, alice.publicKey, NOTE_B),
    ).rejects.toThrow('Chu ky khong hop le');
    // Dung note thi van mo duoc.
    const unwrapped = await unwrapNoteKeyFromSender(forA, bob.privateKey, alice.publicKey, NOTE_A);
    expect(sodium.to_base64(unwrapped)).toBe(sodium.to_base64(noteKey));
  });

  test('thieu hoac sai dinh dang noteId -> bao loi ngay', async () => {
    const alice = await generateSigningKeyPair();
    const bob = await generateKeyPair();
    const noteKey = sodium.randombytes_buf(32);
    await expect(wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey)).rejects.toThrow(
      TypeError,
    );
    await expect(
      wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey, 'note-1'),
    ).rejects.toThrow(TypeError);
    const wrapped = await wrapNoteKeyForRecipient(noteKey, bob.publicKey, alice.privateKey, NOTE_A);
    await expect(unwrapNoteKeyFromSender(wrapped, bob.privateKey, alice.publicKey)).rejects.toThrow(
      TypeError,
    );
  });
});
