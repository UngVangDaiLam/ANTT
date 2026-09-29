/**
 * vault.js
 * --------
 * Buoc 2: ky thuat "key wrapping 2 lop" (envelope encryption).
 *
 * Master Key (tu password) KHONG ma hoa truc tiep tung note.
 * Thay vao do: Vault Key (32 byte ngau nhien) moi la khoa thuc su ma hoa note,
 * va Vault Key duoc "boc" (wrap) boi Master Key.
 *
 * Loi ich: khi doi mat khau, chi can giai ma + ma hoa lai Vault Key (32 byte,
 * cuc nhanh), KHONG PHAI dung lai tung note mot (co the hang nghin note).
 */

import sodium from 'libsodium-wrappers-sumo';
import { toBase64, fromBase64 } from './base64.js';

/**
 * @typedef {{nonce: string, ciphertext: string}} WrappedKey
 * Nonce/ciphertext dang chuoi base64, san sang de gui qua JSON.
 */

export async function ready() {
  await sodium.ready;
}

/** Sinh Vault Key ngau nhien - moi user 1 vault key, sinh 1 lan khi tao tai khoan. */
export function generateVaultKey() {
  return sodium.randombytes_buf(32);
}

/**
 * Boc Vault Key bang Master Key, dung AEAD XChaCha20-Poly1305.
 * Nonce 24 byte -> random moi lan la an toan tuyet doi (khong lo trung nonce
 * nhu AES-GCM 96-bit), nen khong can co che dem/quan ly nonce phuc tap.
 *
 * @param {Uint8Array} vaultKey
 * @param {Uint8Array} masterKey
 * @returns {Promise<WrappedKey>}
 */
export async function wrapVaultKey(vaultKey, masterKey) {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    vaultKey,
    null, // khong co additional data
    null, // (khong dung secret nonce cua libsodium)
    nonce,
    masterKey,
  );
  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Mo Vault Key. Neu masterKey sai HOAC ciphertext bi sua du chi 1 byte,
 * ham nay se throw (Poly1305 tag khong khop) - day chinh la co che "tu kiem
 * tra toan ven" ma de xuat da nhac trong Buoc hoat dong so 5.
 *
 * @param {WrappedKey} wrapped
 * @param {Uint8Array} masterKey
 * @returns {Promise<Uint8Array>}
 */
export async function unwrapVaultKey(wrapped, masterKey) {
  await ready();
  const nonce = fromBase64(wrapped.nonce);
  const ciphertext = fromBase64(wrapped.ciphertext);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    masterKey,
  );
}
