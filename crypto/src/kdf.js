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

import sodium from 'libsodium-wrappers-sumo';

/**
 * Tham so Argon2id mac dinh cho tai khoan MOI - can bang giua bao mat va trai
 * nghiem tren trinh duyet/may yeu. Nen benchmark lai o tuan 8 tren nhieu cau
 * hinh may (xem benchmark/argon2-benchmark.js).
 *
 * QUAN TRONG: tai khoan DA TON TAI phai luu lai dung opslimit/memlimit da
 * dung luc dang ky (server tra kem salt) va truyen vao deriveKeysFromPassword
 * - khong duoc tu y dung hang so hien tai, neu khong se dan sai khoa khi cac
 * gia tri mac dinh nay thay doi trong tuong lai (xem kdfParams trong client-sdk).
 */
export const DEFAULT_OPSLIMIT = 3; // time cost
export const DEFAULT_MEMLIMIT = 64 * 1024 * 1024; // 64 MB memory cost

/** Cho libsodium-wrappers-sumo san sang truoc khi goi bat ky ham nao khac trong file nay. */
export async function ready() {
  await sodium.ready;
}

/** Sinh salt ngau nhien (16 byte) - moi user 1 salt, luu kem tai khoan tren server. */
export function generateSalt() {
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
}

/**
 * Chay Argon2id MOT LAN de ra "root key" 32 byte.
 * Khong chay Argon2id 2 lan cho auth va encryption - vua ton kem CPU/RAM gap doi,
 * vua khong can thiet vi buoc splitKeys() ben duoi da tach an toan roi.
 *
 * @param {string} password - mat khau nguoi dung nhap (dang plaintext, chi ton tai tam thoi trong bo nho).
 * @param {Uint8Array} saltBytes - salt 16 byte, xem generateSalt().
 * @param {{opslimit?: number, memlimit?: number}} [kdfParams] - tham so Argon2id da dung cho tai
 *   khoan nay (lay tu server khi login/doi mat khau); mac dinh DEFAULT_OPSLIMIT/DEFAULT_MEMLIMIT
 *   cho tai khoan MOI dang ky.
 * @returns {Promise<Uint8Array>} root key 32 byte - CHI la buoc trung gian, khong dung truc tiep.
 */
export async function deriveRootKey(password, saltBytes, kdfParams = {}) {
  await ready();
  const opslimit = kdfParams.opslimit ?? DEFAULT_OPSLIMIT;
  const memlimit = kdfParams.memlimit ?? DEFAULT_MEMLIMIT;
  const passwordBytes = sodium.from_string(password);
  const rootKey = sodium.crypto_pwhash(
    32,
    passwordBytes,
    saltBytes,
    opslimit,
    memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
  sodium.memzero(passwordBytes);
  return rootKey;
}

/**
 * Tach root key thanh authKey va masterKey bang crypto_kdf_derive_from_key
 * (KDF dua tren BLAKE2b cua libsodium). Moi "context" 8 byte khac nhau se cho
 * ra khoa hoan toan khac nhau du cung mot rootKey dau vao - tuong duong y tuong
 * HKDF-Expand voi "info" khac nhau ma de xuat da nhac den.
 *
 * @param {Uint8Array} rootKey - ket qua tu deriveRootKey().
 * @returns {{authKey: Uint8Array, masterKey: Uint8Array}}
 */
export function splitKeys(rootKey) {
  const authKey = sodium.crypto_kdf_derive_from_key(32, 1, 'SNauth01', rootKey);
  const masterKey = sodium.crypto_kdf_derive_from_key(32, 2, 'SNenc001', rootKey);
  return { authKey, masterKey };
}

/**
 * Ham tien loi: tu password + salt (+ kdfParams tuy chon) ra thang { authKey, masterKey }.
 *
 * @param {string} password
 * @param {Uint8Array} saltBytes
 * @param {{opslimit?: number, memlimit?: number}} [kdfParams]
 * @returns {Promise<{authKey: Uint8Array, masterKey: Uint8Array}>}
 */
export async function deriveKeysFromPassword(password, saltBytes, kdfParams = {}) {
  const rootKey = await deriveRootKey(password, saltBytes, kdfParams);
  const keys = splitKeys(rootKey);
  sodium.memzero(rootKey); // xoa root key khoi bo nho ngay khi da tach xong
  return keys;
}
