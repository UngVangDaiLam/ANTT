/**
 * note.js
 * -------
 * Buoc 3: ma hoa/giai ma noi dung note bang Vault Key (hoac note-key rieng
 * cua tung note - xem client-sdk). Day la phan client goi truc tiep khi user
 * bam Save / mo note. Server chi nhan va luu dung {nonce, ciphertext} - khong
 * biet gi khac.
 *
 * LUU Y: phien ban nay CHUA co Associated Data (AD) rang buoc ciphertext voi
 * noteId/version/ownerId - day la viec can lam THEM (xem khung do an, muc
 * "chong rollback") truoc khi coi la hoan thien cho phan nop.
 */

import sodium from 'libsodium-wrappers-sumo';
import { toBase64, fromBase64 } from './base64.js';

/**
 * @typedef {{nonce: string, ciphertext: string}} EncryptedPayload
 */

export async function ready() {
  await sodium.ready;
}

/**
 * Ma hoa noi dung note (chuoi text) bang mot khoa AEAD 32 byte. Nonce moi lan random.
 *
 * @param {string} plaintext
 * @param {Uint8Array} key - Vault Key hoac note-key rieng cua 1 note.
 * @returns {Promise<EncryptedPayload>}
 */
export async function encryptNote(plaintext, key) {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const plaintextBytes = sodium.from_string(plaintext);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    null,
    null,
    nonce,
    key,
  );
  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Giai ma note. Throw ngay neu ciphertext bi sua (integrity check cua AEAD) -
 * dung goi nay trong try/catch o tang API/UI de bao "Note bi hong hoac sai khoa".
 *
 * @param {EncryptedPayload} encryptedNote
 * @param {Uint8Array} key
 * @returns {Promise<string>}
 */
export async function decryptNote(encryptedNote, key) {
  await ready();
  const nonce = fromBase64(encryptedNote.nonce);
  const ciphertext = fromBase64(encryptedNote.ciphertext);
  const plaintextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    key,
  );
  return sodium.to_string(plaintextBytes);
}
