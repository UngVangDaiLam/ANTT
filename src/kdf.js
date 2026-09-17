/**
 * kdf.js
 * -------
 * Buoc 1 cua module crypto: bien mat khau nguoi dung thanh 2 khoa rieng biet
 * - authKey    : gui len server de xac thuc (server se hash them 1 lop nua roi moi luu)
 * - masterKey  : KHONG BAO GIO roi khoi client, dung de boc Vault Key (xem vault.js)
 *
 * Vi sao can 2 khoa rieng: neu dung chung 1 khoa cho ca auth va encryption,
 * server (noi luu authKey de xac thuc) coi nhu nam duoc encryption key -> pha vo E2EE.
 */

const sodium = require('libsodium-wrappers-sumo');

// Tham so Argon2id - can bang giua bao mat va trai nghiem tren trinh duyet/may yeu.
// Nen benchmark lai o tuan 8 tren nhieu cau hinh may (xem benchmark/argon2-benchmark.js)
const OPSLIMIT = 3; // time cost
const MEMLIMIT = 64 * 1024 * 1024; // 64 MB memory cost

async function ready() {
  await sodium.ready;
}

/** Sinh salt ngau nhien (16 byte) - moi user 1 salt, luu kem tai khoan tren server */
function generateSalt() {
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
}

/**
 * Chay Argon2id MOT LAN de ra "root key" 32 byte.
 * Khong chay Argon2id 2 lan cho auth va encryption - vua ton kem CPU/RAM gap doi,
 * vua khong can thiet vi buoc splitKeys() ben duoi da tach an toan roi.
 */
async function deriveRootKey(password, saltBytes) {
  await ready();
  const passwordBytes = sodium.from_string(password);
  const rootKey = sodium.crypto_pwhash(
    32,
    passwordBytes,
    saltBytes,
    OPSLIMIT,
    MEMLIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
  sodium.memzero(passwordBytes);
  return rootKey; // Uint8Array 32 byte - CHI la buoc trung gian, khong dung truc tiep
}

/**
 * Tach root key thanh authKey va masterKey bang crypto_kdf_derive_from_key
 * (KDF dua tren BLAKE2b cua libsodium). Moi "context" 8 byte khac nhau se cho
 * ra khoa hoan toan khac nhau du cung mot rootKey dau vao - tuong duong y tuong
 * HKDF-Expand voi "info" khac nhau ma de xuat da nhac den.
 */
function splitKeys(rootKey) {
  const authKey = sodium.crypto_kdf_derive_from_key(32, 1, 'SNauth01', rootKey);
  const masterKey = sodium.crypto_kdf_derive_from_key(32, 2, 'SNenc001', rootKey);
  return { authKey, masterKey };
}

/** Ham tien loi: tu password + salt ra thang { authKey, masterKey } */
async function deriveKeysFromPassword(password, saltBytes) {
  const rootKey = await deriveRootKey(password, saltBytes);
  const keys = splitKeys(rootKey);
  sodium.memzero(rootKey); // xoa root key khoi bo nho ngay khi da tach xong
  return keys;
}

module.exports = {
  ready,
  generateSalt,
  deriveRootKey,
  splitKeys,
  deriveKeysFromPassword,
  OPSLIMIT,
  MEMLIMIT,
};
