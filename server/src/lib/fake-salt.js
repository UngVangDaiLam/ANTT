import { createHmac } from 'node:crypto';
import { CRYPTO_SIZES } from '@secure-notes/shared';

/**
 * Salt giả, cố định theo email, cho email CHƯA đăng ký.
 * Nhờ vậy API lấy salt trả lời giống hệt nhau dù email có tồn tại hay không,
 * kẻ tấn công không dò được ai đã có tài khoản.
 * @returns {string} base64url không padding
 */
export function fakeSaltFor(normalizedEmail, serverSecret) {
  return createHmac('sha256', serverSecret)
    .update(`fake-salt:${normalizedEmail}`)
    .digest()
    .subarray(0, CRYPTO_SIZES.SALT_BYTES)
    .toString('base64url');
}
