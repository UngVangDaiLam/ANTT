import { createHash, randomBytes } from 'node:crypto';

/** 32 byte ngẫu nhiên = 256 bit entropy, dạng base64url không padding (ASVS 7.2.3 yêu cầu >= 128 bit). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Token phiên: chỉ nằm trong cookie của người dùng. Server KHÔNG lưu token gốc.
 * @returns {string}
 */
export function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}

/** Cookie do client gửi lên có thể là bất cứ thứ gì; loại sớm thứ không đúng hình dạng. */
export function isWellFormedSessionToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/**
 * Id của bản ghi `Session` là SHA-256 của token. Lộ database không dựng lại được cookie.
 * SHA-256 thường là đủ, không cần băm chậm: token đã có 256 bit ngẫu nhiên nên không đoán được.
 * @param {string} token
 * @returns {string} hex
 */
export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
