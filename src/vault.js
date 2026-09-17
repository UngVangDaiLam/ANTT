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

const sodium = require('libsodium-wrappers-sumo');

async function ready() {
  await sodium.ready;
}

/** Sinh Vault Key ngau nhien - moi user 1 vault key, sinh 1 lan khi tao tai khoan */
function generateVaultKey() {
  return sodium.randombytes_buf(32);
}

/**
 * Boc Vault Key bang Master Key, dung AEAD XChaCha20-Poly1305.
 * Nonce 24 byte -> random moi lan la an toan tuyet doi (khong lo trung nonce
 * nhu AES-GCM 96-bit), nen khong can co che dem/quan ly nonce phuc tap.
 */
async function wrapVaultKey(vaultKey, masterKey) {
  await ready();
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    vaultKey,
    null, // khong co additional data
    null, // (khong dung secret nonce cua libsodium)
    nonce,
    masterKey
  );
  return {
    nonce: sodium.to_base64(nonce),
    ciphertext: sodium.to_base64(ciphertext),
  };
}

/**
 * Mo Vault Key. Neu masterKey sai HOAC ciphertext bi sua du chi 1 byte,
 * ham nay se throw (Poly1305 tag khong khop) - day chinh la co che "tu kiem
 * tra toan ven" ma de xuat da nhac trong Buoc hoat dong so 5.
 */
async function unwrapVaultKey(wrapped, masterKey) {
  await ready();
  const nonce = sodium.from_base64(wrapped.nonce);
  const ciphertext = sodium.from_base64(wrapped.ciphertext);
  const vaultKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    masterKey
  );
  return vaultKey;
}

module.exports = { generateVaultKey, wrapVaultKey, unwrapVaultKey };
