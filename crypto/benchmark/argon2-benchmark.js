/**
 * Chạy: pnpm --filter @secure-notes/crypto benchmark
 *
 * Đo thời gian Argon2id với các mức memory cost khác nhau TRÊN MÁY NÀY. Nên chạy
 * thêm trên một máy yếu hơn và trên trình duyệt di động (DevTools throttling) để
 * có số liệu đưa vào báo cáo.
 *
 * Đọc kết quả: đây là chi phí người dùng phải trả mỗi lần đăng nhập, và cũng là
 * chi phí kẻ tấn công phải trả cho MỖI mật khẩu đoán thử khi chúng có được
 * database. Chọn tham số cao nhất mà vẫn chấp nhận được về trải nghiệm.
 */

import sodium from 'libsodium-wrappers-sumo';
import { KDF_DEFAULTS } from '@secure-notes/shared';

const PASSWORD = 'MatKhauThuNghiem123!';
const MEM_MB_SWEEP = [16, 32, 64, 128];

/**
 * @param {number} memMB memory cost, tính bằng MB
 * @param {number} opslimit time cost
 * @returns {number} thời gian chạy, tính bằng ms
 */
function bench(memMB, opslimit) {
  const password = sodium.from_string(PASSWORD);
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);

  const start = performance.now();
  sodium.crypto_pwhash(
    32,
    password,
    salt,
    opslimit,
    memMB * 1024 * 1024,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const elapsed = performance.now() - start;

  sodium.memzero(password);
  return elapsed;
}

await sodium.ready;

const defaultMemMB = KDF_DEFAULTS.memlimit / (1024 * 1024);
console.log(`Benchmark Argon2id trên máy hiện tại (opslimit = ${KDF_DEFAULTS.opslimit}):`);

for (const memMB of MEM_MB_SWEEP) {
  const elapsed = bench(memMB, KDF_DEFAULTS.opslimit);
  const dangDung = memMB === defaultMemMB ? '  <- KDF_DEFAULTS hiện tại' : '';
  console.log(
    `  memlimit = ${String(memMB).padStart(3)} MB  ->  ${elapsed.toFixed(0)} ms${dangDung}`,
  );
}
