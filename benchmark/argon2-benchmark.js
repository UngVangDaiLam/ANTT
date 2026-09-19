/**
 * Chay: npm run benchmark
 * Do thoi gian Argon2id voi cac muc memory cost khac nhau tren MAY NAY.
 * Nen chay them tren 1 may yeu hon va tren mobile browser (qua DevTools throttling)
 * de co so lieu dua vao bao cao (Tuan 8 trong lo trinh).
 */
const sodium = require('libsodium-wrappers-sumo');

async function bench(memMB, opslimit) {
  const password = sodium.from_string('MatKhauThuNghiem123!');
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const memlimit = memMB * 1024 * 1024;

  const start = Date.now();
  sodium.crypto_pwhash(32, password, salt, opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
  const elapsed = Date.now() - start;
  console.log(`memlimit=${memMB}MB\topslimit=${opslimit}\t-> ${elapsed} ms`);
}

(async () => {
  await sodium.ready;
  console.log('Benchmark Argon2id tren may hien tai:');
  for (const mem of [16, 32, 64, 128]) {
    await bench(mem, 3);
  }
})();
