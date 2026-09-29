/**
 * [Lâm] Điểm export duy nhất của module crypto.
 *
 * Module này không gọi mạng, không biết server tồn tại, không biết gì về giao
 * diện — ranh giới đó được kiểm tra tự động bằng `pnpm depcheck`.
 */
import _sodium from 'libsodium-wrappers-sumo';

/** Đảm bảo libsodium đã khởi tạo xong trước khi dùng. */
export async function getSodium() {
  await _sodium.ready;
  return _sodium;
}

// Namespace theo module (không dùng `export *`): cả 4 file đều export hàm
// `ready`, gộp phẳng sẽ đụng tên. client-sdk gọi dạng kdf.generateSalt(),
// vault.wrapVaultKey()... nên export namespace là đúng cách dùng sẵn có.
export * as kdf from './kdf.js';
export * as vault from './vault.js';
export * as note from './note.js';
export * as sharing from './sharing.js';

// Quy ước mã hóa nhị phân (D11) — client-sdk dùng lại để khỏi tự chọn biến thể base64.
export { toBase64, fromBase64 } from './base64.js';
