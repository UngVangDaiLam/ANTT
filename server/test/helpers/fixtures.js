import { randomBytes } from 'node:crypto';
import { KDF_DEFAULTS } from '@secure-notes/shared';

export const b64 = (bytes) => randomBytes(bytes).toString('base64url');

/** Dữ liệu đã mã hóa hợp lệ về hình dạng: nonce 24 byte, ciphertext 48 byte (32 byte + tag). */
export const sealed = () => ({ nonce: b64(24), ciphertext: b64(48) });

/** Body hợp lệ theo RegisterRequest; ghi đè từng trường qua `overrides`. */
export function registerBody(overrides = {}) {
  return {
    email: 'lam@example.com',
    salt: b64(16),
    kdfParams: { ...KDF_DEFAULTS },
    authKey: b64(32),
    wrappedVaultKey: sealed(),
    x25519PublicKey: b64(32),
    ed25519PublicKey: b64(32),
    wrappedX25519PrivateKey: sealed(),
    wrappedEd25519PrivateKey: sealed(),
    ...overrides,
  };
}

/** Body hợp lệ theo NoteCreateRequest. */
export function noteBody(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    version: 1,
    encryptedTitle: sealed(),
    encryptedContent: sealed(),
    wrappedNoteKey: sealed(),
    ...overrides,
  };
}

/** Body hợp lệ theo NoteUpdateRequest. */
export function updateBody(version, overrides = {}) {
  return { version, encryptedTitle: sealed(), encryptedContent: sealed(), ...overrides };
}

/** Gói chia sẻ hợp lệ về hình dạng (server không mở được, chỉ kiểm tra độ dài). */
export function sharePackage() {
  return {
    ephemeralPublicKey: b64(32),
    nonce: b64(24),
    ciphertext: b64(48),
    signature: b64(64),
  };
}

/** Body hợp lệ theo RotateRequest; `shares` là mảng email người còn quyền. */
export function rotateBody(version, recipientEmails = [], overrides = {}) {
  return {
    version,
    encryptedTitle: sealed(),
    encryptedContent: sealed(),
    wrappedNoteKey: sealed(),
    shares: recipientEmails.map((recipientEmail) => ({
      recipientEmail,
      sharePackage: sharePackage(),
    })),
    ...overrides,
  };
}

/** Body hợp lệ theo ChangePasswordRequest. */
export function changePasswordBody(oldAuthKey, overrides = {}) {
  return {
    oldAuthKey,
    salt: b64(16),
    kdfParams: { ...KDF_DEFAULTS },
    authKey: b64(32),
    wrappedVaultKey: sealed(),
    wrappedX25519PrivateKey: sealed(),
    wrappedEd25519PrivateKey: sealed(),
    ...overrides,
  };
}
