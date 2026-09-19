/**
 * Schema TypeBox dùng chung.
 * - server: Fastify dùng trực tiếp làm JSON Schema để kiểm tra request.
 * - client-sdk: dùng Value.Check để kiểm tra response (KHÔNG dùng ajv vì ajv
 *   sinh code bằng new Function, bị CSP chặn trên trình duyệt).
 *
 * Schema cho từng endpoint được thêm dần theo docs/API.md.
 * Quy ước: mọi Object đều additionalProperties: false.
 */
import { Type } from '@sinclair/typebox';
import { CRYPTO_SIZES, LIMITS } from './config.js';

const strict = { additionalProperties: false };

/** Chuỗi base64url không padding. */
export const Base64Url = Type.String({ pattern: '^[A-Za-z0-9_-]+$', minLength: 1 });

/**
 * Chuỗi base64url không padding mã hóa đúng `bytes` byte.
 * @param {number} bytes
 */
export function Base64UrlBytes(bytes) {
  const length = Math.ceil((bytes * 4) / 3);
  return Type.String({ pattern: '^[A-Za-z0-9_-]+$', minLength: length, maxLength: length });
}

export const Uuid = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});

/** Cho phép khoảng trắng hai đầu vì server còn chuẩn hóa lại (D10). */
export const Email = Type.String({
  minLength: 3,
  maxLength: LIMITS.MAX_EMAIL_LENGTH,
  pattern: '^\\s*[^\\s@]+@[^\\s@]+\\s*$',
});

/** Dữ liệu đã mã hóa/bọc bằng XChaCha20-Poly1305. */
export const Sealed = Type.Object({ nonce: Base64Url, ciphertext: Base64Url }, strict);

export const KdfParams = Type.Object(
  { opslimit: Type.Integer({ minimum: 1 }), memlimit: Type.Integer({ minimum: 8192 }) },
  strict,
);

/** Gói chia sẻ (Lâm chốt chi tiết; chữ ký phải bao gồm noteId). */
export const SharePackage = Type.Object(
  { ephemeralPublicKey: Base64Url, nonce: Base64Url, ciphertext: Base64Url, signature: Base64Url },
  strict,
);

/** POST /api/register. Xem docs/API.md. */
export const RegisterRequest = Type.Object(
  {
    email: Email,
    salt: Base64UrlBytes(CRYPTO_SIZES.SALT_BYTES),
    kdfParams: KdfParams,
    authKey: Base64UrlBytes(CRYPTO_SIZES.AUTH_KEY_BYTES),
    wrappedVaultKey: Sealed,
    x25519PublicKey: Base64UrlBytes(CRYPTO_SIZES.PUBLIC_KEY_BYTES),
    ed25519PublicKey: Base64UrlBytes(CRYPTO_SIZES.PUBLIC_KEY_BYTES),
    wrappedX25519PrivateKey: Sealed,
    wrappedEd25519PrivateKey: Sealed,
  },
  strict,
);

export const ErrorBody = Type.Object({ code: Type.String(), message: Type.String() }, strict);
