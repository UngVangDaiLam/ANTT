/**
 * base64.js
 * ---------
 * Một chỗ duy nhất quyết định cách mã hóa nhị phân sang chuỗi (D11: base64url
 * KHÔNG padding).
 *
 * Đúng là đây cũng là biến thể mặc định của libsodium, nên viết `to_base64(x)`
 * cho kết quả y hệt. Nhưng cả hệ thống đang phụ thuộc vào biến thể này: schema
 * trong `shared/` kiểm tra bằng pattern `^[A-Za-z0-9_-]+$` và độ dài chính xác
 * theo số byte, nên chỉ cần một chỗ nào đó lỡ dùng `base64_variants.ORIGINAL`
 * (có dấu `+`, `/`, `=`) là server từ chối request mà không rõ vì sao. Ghi rõ
 * biến thể ra biến quy ước ngầm thành quy ước tường minh.
 */

import sodium from 'libsodium-wrappers-sumo';

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64url không padding
 */
export function toBase64(bytes) {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

/**
 * @param {string} text base64url không padding
 * @returns {Uint8Array}
 */
export function fromBase64(text) {
  return sodium.from_base64(text, sodium.base64_variants.URLSAFE_NO_PADDING);
}
