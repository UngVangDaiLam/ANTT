/**
 * [Lâm] Điểm export duy nhất của module crypto.
 *
 * Việc cần làm khi chuyển code cũ vào đây (xem README, mục "Chuyển code của Lâm"):
 *   src/kdf.js, src/vault.js, src/note.js, src/sharing.js  ->  crypto/src/
 *   test/kdf|vault|note|sharing.test.js                    ->  crypto/test/
 *   benchmark/argon2-benchmark.js                          ->  crypto/benchmark/
 *
 * Rồi đổi require(...) -> import, module.exports -> export, và export lại ở đây:
 *   export * from './kdf.js';
 *   export * from './vault.js';
 *   export * from './note.js';
 *   export * from './sharing.js';
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
