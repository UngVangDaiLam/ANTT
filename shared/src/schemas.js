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
import { CRYPTO_SIZES, LIMITS, NOTE_VERSION_START } from './config.js';

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

/**
 * Email ĐÃ chuẩn hóa. Dùng cho response: server chỉ trả về dạng đã trim + chữ
 * thường, nên client từ chối luôn nếu nhận được thứ khác.
 */
export const NormalizedEmail = Type.String({
  minLength: 3,
  maxLength: LIMITS.MAX_EMAIL_LENGTH,
  pattern: '^[^\\s@]+@[^\\s@]+$',
});

/**
 * Thời điểm dạng ISO-8601 UTC, ví dụ "2026-09-20T10:11:12.000Z".
 * Dùng pattern thay vì `format: 'date-time'` để ajv (server) và Value.Check
 * (client) kiểm tra giống hệt nhau; TypeBox bỏ qua format chưa đăng ký.
 */
export const IsoDateTime = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z$' });

/** Version của note: số nguyên, bắt đầu từ NOTE_VERSION_START (D18). */
export const NoteVersion = Type.Integer({ minimum: NOTE_VERSION_START });

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

// ---------------------------------------------------------------------------
// Tài khoản
// ---------------------------------------------------------------------------

/** GET /api/users/:email/salt. Email chưa đăng ký vẫn trả salt giả (D15). */
export const SaltResponse = Type.Object(
  { salt: Base64UrlBytes(CRYPTO_SIZES.SALT_BYTES), kdfParams: KdfParams },
  strict,
);

/** POST /api/login. */
export const LoginRequest = Type.Object(
  { email: Email, authKey: Base64UrlBytes(CRYPTO_SIZES.AUTH_KEY_BYTES) },
  strict,
);

/**
 * Body của POST /api/login và GET /api/me: mọi thứ client cần để mở khóa phiên
 * làm việc. Khóa riêng luôn ở dạng đã bọc bằng masterKey, server không mở được.
 */
export const SelfAccountResponse = Type.Object(
  {
    email: NormalizedEmail,
    wrappedVaultKey: Sealed,
    x25519PublicKey: Base64UrlBytes(CRYPTO_SIZES.PUBLIC_KEY_BYTES),
    ed25519PublicKey: Base64UrlBytes(CRYPTO_SIZES.PUBLIC_KEY_BYTES),
    wrappedX25519PrivateKey: Sealed,
    wrappedEd25519PrivateKey: Sealed,
  },
  strict,
);

/** GET /api/users/:email/keys: khóa công khai của người khác, để chia sẻ note. */
export const UserKeysResponse = Type.Object(
  {
    x25519PublicKey: Base64UrlBytes(CRYPTO_SIZES.PUBLIC_KEY_BYTES),
    ed25519PublicKey: Base64UrlBytes(CRYPTO_SIZES.PUBLIC_KEY_BYTES),
  },
  strict,
);

/**
 * POST /api/change-password (D25). `oldAuthKey` chứng minh người gọi biết mật
 * khẩu cũ; các khóa còn lại đã được bọc lại bằng masterKey mới ở phía client.
 */
export const ChangePasswordRequest = Type.Object(
  {
    oldAuthKey: Base64UrlBytes(CRYPTO_SIZES.AUTH_KEY_BYTES),
    salt: Base64UrlBytes(CRYPTO_SIZES.SALT_BYTES),
    kdfParams: KdfParams,
    authKey: Base64UrlBytes(CRYPTO_SIZES.AUTH_KEY_BYTES),
    wrappedVaultKey: Sealed,
    wrappedX25519PrivateKey: Sealed,
    wrappedEd25519PrivateKey: Sealed,
  },
  strict,
);

// ---------------------------------------------------------------------------
// Note
// ---------------------------------------------------------------------------

/** POST /api/notes. `id` do client sinh (D17), version luôn bắt đầu từ 1 (D18). */
export const NoteCreateRequest = Type.Object(
  {
    id: Uuid,
    version: Type.Literal(NOTE_VERSION_START),
    encryptedTitle: Sealed,
    encryptedContent: Sealed,
    wrappedNoteKey: Sealed,
  },
  strict,
);

/** PUT /api/notes/:id. Server chỉ nhận khi version = version hiện tại + 1 (D18). */
export const NoteUpdateRequest = Type.Object(
  {
    version: Type.Integer({ minimum: NOTE_VERSION_START + 1 }),
    encryptedTitle: Sealed,
    encryptedContent: Sealed,
  },
  strict,
);

/** Kết quả của POST/PUT note: đủ để client cập nhật trạng thái, không phải gọi lại. */
export const NoteWriteResponse = Type.Object(
  { id: Uuid, version: NoteVersion, updatedAt: IsoDateTime },
  strict,
);

/**
 * Một dòng trong danh sách note: KHÔNG có nội dung, chỉ tiêu đề đã mã hóa (D21).
 * Có kèm `wrappedNoteKey` vì không có nó thì client không mở nổi tiêu đề, và
 * danh sách note sẽ chỉ là một cột trống — nó là khóa note đã bọc bằng Vault Key
 * của chính người gọi, nên server vẫn không đọc được gì.
 */
export const NoteListItem = Type.Object(
  {
    id: Uuid,
    version: NoteVersion,
    encryptedTitle: Sealed,
    wrappedNoteKey: Sealed,
    updatedAt: IsoDateTime,
  },
  strict,
);

export const NoteListResponse = Type.Array(NoteListItem);

/**
 * GET /api/notes/:id. Chủ note nhận `wrappedNoteKey`; người được chia sẻ nhận
 * `share` (D22: đọc theo tham chiếu, server không sao chép ciphertext).
 * Đúng một trong hai trường có mặt — client phải tự kiểm tra và từ chối nếu
 * thiếu cả hai, vì schema không diễn đạt được ràng buộc "loại trừ nhau".
 */
export const NoteResponse = Type.Object(
  {
    id: Uuid,
    version: NoteVersion,
    encryptedTitle: Sealed,
    encryptedContent: Sealed,
    updatedAt: IsoDateTime,
    wrappedNoteKey: Type.Optional(Sealed),
    share: Type.Optional(
      Type.Object({ senderEmail: NormalizedEmail, sharePackage: SharePackage }, strict),
    ),
  },
  strict,
);

// ---------------------------------------------------------------------------
// Chia sẻ
// ---------------------------------------------------------------------------

/** POST /api/notes/:id/shares. Người gửi lấy từ phiên, không nhận từ body (D16). */
export const ShareCreateRequest = Type.Object(
  { recipientEmail: Email, sharePackage: SharePackage },
  strict,
);

export const ShareCreatedResponse = Type.Object({ id: Uuid }, strict);

/** Một dòng trong GET /api/shares: các gói chia sẻ gửi tới mình. */
export const ShareListItem = Type.Object(
  { id: Uuid, noteId: Uuid, senderEmail: NormalizedEmail, createdAt: IsoDateTime },
  strict,
);

export const ShareListResponse = Type.Array(ShareListItem);
