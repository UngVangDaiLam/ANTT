/**
 * note.js
 * -------
 * Buoc 3: ma hoa/giai ma noi dung note bang Vault Key.
 * Day la phan client goi truc tiep khi user bam Save / mo note.
 * Server chi nhan va luu dung {nonce, ciphertext} - khong biet gi khac.
 */

const sodium = require('libsodium-wrappers-sumo');

async function ready() {
  await sodium.ready;
}

/** Ma hoa noi dung note (chuoi text) bang Vault Key. Nonce moi lan random. */
async function encryptNote(plaintext, vaultKey) {
  await ready();
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );
  const plaintextBytes = sodium.from_string(plaintext);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    null,
    null,
    nonce,
    vaultKey
  );
  return {
    nonce: sodium.to_base64(nonce),
    ciphertext: sodium.to_base64(ciphertext),
  };
}

/**
 * Giai ma note. Throw ngay neu ciphertext bi sua (integrity check cua AEAD) -
 * dung goi nay trong try/catch o tang API/UI de bao "Note bi hong hoac sai khoa".
 */
async function decryptNote(encryptedNote, vaultKey) {
  await ready();
  const nonce = sodium.from_base64(encryptedNote.nonce);
  const ciphertext = sodium.from_base64(encryptedNote.ciphertext);
  const plaintextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    vaultKey
  );
  return sodium.to_string(plaintextBytes);
}

module.exports = { encryptNote, decryptNote };
