/**
 * Mọi hằng số dùng chung giữa client và server gom về đây.
 * Muốn đổi giá trị nào thì đổi ở một chỗ duy nhất này.
 */

/** Tham số Argon2id mặc định cho tài khoản MỚI. Server lưu kdfParams theo từng user. */
export const KDF_DEFAULTS = Object.freeze({
  opslimit: 3,
  memlimit: 64 * 1024 * 1024, // 64 MB
});

export const LIMITS = Object.freeze({
  /** Client chặn nội dung gốc (trước khi mã hóa) vượt ngưỡng này. */
  MAX_NOTE_PLAINTEXT_BYTES: 512 * 1024,
  /** Server chặn toàn bộ request vượt ngưỡng này (Fastify bodyLimit). */
  MAX_REQUEST_BYTES: 1024 * 1024,
  MAX_EMAIL_LENGTH: 254,
});

/** Kích thước (byte) các giá trị nhị phân, theo hằng số của libsodium. Server dùng để kiểm tra độ dài. */
export const CRYPTO_SIZES = Object.freeze({
  SALT_BYTES: 16, // crypto_pwhash_SALTBYTES
  AUTH_KEY_BYTES: 32, // khóa con tách từ Argon2id bằng crypto_kdf
  PUBLIC_KEY_BYTES: 32, // X25519 và Ed25519 đều 32 byte
});

/** Giới hạn tần suất cho các route nhạy cảm, tính theo IP. */
export const RATE_LIMITS = Object.freeze({
  REGISTER: { max: 5, timeWindowMs: 15 * 60 * 1000 },
});

/** Version của note bắt đầu từ 1; mỗi lần sửa phải đúng bằng version hiện tại + 1. */
export const NOTE_VERSION_START = 1;

export const SESSION = Object.freeze({
  COOKIE_NAME: 'sid',
  TTL_MS: 24 * 60 * 60 * 1000, // 24 giờ
});

/** Client tự khóa (xóa khóa khỏi bộ nhớ) sau khoảng thời gian không thao tác. */
export const AUTO_LOCK_MS = 15 * 60 * 1000;

/** Mọi dữ liệu nhị phân trao đổi qua JSON dùng base64url KHÔNG padding (mặc định của libsodium). */
export const BINARY_ENCODING = 'base64url-no-padding';
