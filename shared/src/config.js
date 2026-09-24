/**
 * Mọi hằng số dùng chung giữa client và server gom về đây.
 * Muốn đổi giá trị nào thì đổi ở một chỗ duy nhất này.
 */

/** Tham số Argon2id mặc định cho tài khoản MỚI. Server lưu kdfParams theo từng user. */
export const KDF_DEFAULTS = Object.freeze({
  opslimit: 3,
  memlimit: 64 * 1024 * 1024, // 64 MB
});

/**
 * Sàn và trần của tham số Argon2id mà server được phép lưu và client được phép chấp nhận.
 *
 * Sàn là mức tối thiểu OWASP khuyến nghị cho Argon2id (m = 19 MiB, t = 2). Client kiểm tra
 * response của `/salt` bằng chính các giới hạn này, nên một server độc hại không ép được client
 * dẫn xuất khóa bằng tham số yếu rồi mang authKey đi dò mật khẩu offline.
 * Trần chặn server gửi tham số khổng lồ làm treo hoặc sập tab trình duyệt.
 */
export const KDF_MINIMUMS = Object.freeze({ opslimit: 2, memlimit: 19 * 1024 * 1024 });
export const KDF_MAXIMUMS = Object.freeze({ opslimit: 16, memlimit: 1024 * 1024 * 1024 });

export const LIMITS = Object.freeze({
  /** Client chặn nội dung gốc (trước khi mã hóa) vượt ngưỡng này. */
  MAX_NOTE_PLAINTEXT_BYTES: 512 * 1024,
  /** Tiêu đề chỉ là một dòng; client chặn tiêu đề gốc vượt ngưỡng này, server chặn ciphertext tương ứng. */
  MAX_NOTE_TITLE_BYTES: 1024,
  /** Khóa đã bọc (vaultKey, noteKey, private key) đều nhỏ hơn nhiều so với mức này. */
  MAX_WRAPPED_KEY_BYTES: 128,
  /** Số người nhận tối đa trong một lần xoay khóa note (POST /notes/:id/rotate). */
  MAX_ROTATE_SHARES: 50,
  /** Server chặn toàn bộ request vượt ngưỡng này (Fastify bodyLimit). */
  MAX_REQUEST_BYTES: 1024 * 1024,
  MAX_EMAIL_LENGTH: 254,
  /** Cắt User-Agent trước khi lưu vào phiên và lịch sử đăng nhập, tránh header khổng lồ làm phình DB. */
  MAX_USER_AGENT_LENGTH: 512,
});

/** Kích thước (byte) các giá trị nhị phân, theo hằng số của libsodium. Server dùng để kiểm tra độ dài. */
export const CRYPTO_SIZES = Object.freeze({
  SALT_BYTES: 16, // crypto_pwhash_SALTBYTES
  AUTH_KEY_BYTES: 32, // khóa con tách từ Argon2id bằng crypto_kdf
  PUBLIC_KEY_BYTES: 32, // X25519 và Ed25519 đều 32 byte
  NONCE_BYTES: 24, // crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  AEAD_TAG_BYTES: 16, // Poly1305; ciphertext luôn dài hơn bản rõ đúng chừng này
  SIGNATURE_BYTES: 64, // Ed25519
});

/** Giới hạn tần suất cho các route nhạy cảm, tính theo IP. */
export const RATE_LIMITS = Object.freeze({
  REGISTER: { max: 5, timeWindowMs: 15 * 60 * 1000 },
  LOGIN: { max: 10, timeWindowMs: 15 * 60 * 1000 },
  /** Mỗi lần đăng nhập gọi salt một lần, nên ngưỡng phải rộng hơn LOGIN. */
  SALT: { max: 30, timeWindowMs: 15 * 60 * 1000 },
  /** Đổi mật khẩu cũng là một chỗ thử `oldAuthKey`, nên phải chặt như đăng nhập. */
  CHANGE_PASSWORD: { max: 5, timeWindowMs: 15 * 60 * 1000 },
  /** Tra khóa công khai xác nhận email có tồn tại, nên không để dò hàng loạt. */
  USER_KEYS: { max: 60, timeWindowMs: 15 * 60 * 1000 },
});

/** Version của note bắt đầu từ 1; mỗi lần sửa phải đúng bằng version hiện tại + 1. */
export const NOTE_VERSION_START = 1;

export const SESSION = Object.freeze({
  /**
   * Tiền tố `__Host-` buộc trình duyệt chỉ nhận cookie khi có `Secure`, `Path=/` và không có
   * `Domain`: subdomain khác không ghi đè được cookie phiên (ASVS 3.3.1).
   */
  COOKIE_NAME: '__Host-sid',
  TTL_MS: 24 * 60 * 60 * 1000, // 24 giờ, tính từ lúc đăng nhập, không gia hạn
  /** Chỉ ghi lại `lastSeenAt` khi đã cũ hơn ngưỡng này, để không ghi DB ở mỗi request. */
  TOUCH_INTERVAL_MS: 60 * 1000,
});

/** Client tự khóa (xóa khóa khỏi bộ nhớ) sau khoảng thời gian không thao tác. */
export const AUTO_LOCK_MS = 15 * 60 * 1000;

/** Mọi dữ liệu nhị phân trao đổi qua JSON dùng base64url KHÔNG padding (mặc định của libsodium). */
export const BINARY_ENCODING = 'base64url-no-padding';
