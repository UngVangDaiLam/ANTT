/**
 * note.js
 * -------
 * Buoc 3: ma hoa/giai ma noi dung note bang note-key rieng cua tung note (xem
 * client-sdk). Server chi nhan va luu dung {nonce, ciphertext} - khong biet gi khac.
 *
 * ASSOCIATED DATA (D19, D65): moi ciphertext duoc GAN voi dung note, dung version
 * va dung truong (tieu de hay noi dung) ma no thuoc ve. AD khong duoc ma hoa,
 * nhung nam trong phep tinh Poly1305 tag: doi bat ky phan nao cua AD luc giai ma
 * thi giai ma THAT BAI. Nho vay mot server doc hai khong the:
 *   - lay ciphertext cua note A tra ve khi client hoi note B (noteId khac);
 *   - tra ciphertext cu nhung khai la version moi (version khac);
 *   - trao ciphertext tieu de voi noi dung - hai truong dung CHUNG mot khoa (D21),
 *     neu AD khong co ten truong thi viec trao nay khong bi phat hien.
 * Server van co the tra ve TRON VEN mot phien ban cu (ciphertext cu + version cu,
 * khop nhau): chong viec do la viec cua client-sdk (D20, nho version cao nhat da thay).
 *
 * AD la BAT BUOC: quen truyen thi bao loi ngay, khong am tham ma hoa khong rang buoc.
 */

import sodium from 'libsodium-wrappers-sumo';
import { toBase64, fromBase64 } from './base64.js';

/**
 * @typedef {{nonce: string, ciphertext: string}} EncryptedPayload
 * @typedef {'title' | 'content'} NoteField
 * @typedef {{noteId: string, version: number, field: NoteField}} NoteContext
 */

/**
 * Nhan tach ngu canh (domain separation) + phien ban dinh dang AD. KHONG phai cau hinh:
 * doi chuoi nay la moi ciphertext cu khong giai ma duoc nua.
 */
const NOTE_AD_LABEL = 'secure-notes/note/v1';
const NOTE_FIELDS = new Set(['title', 'content']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function ready() {
  await sodium.ready;
}

/**
 * Dung Associated Data tu ngu canh cua ciphertext.
 *
 * Kiem tra chat tung thanh phan: noteId dung dang UUID v4 (do dai co dinh), version la
 * so nguyen duong, field nam trong danh sach cho phep. Nho vay chuoi AD luon mot nghia,
 * khong the co hai ngu canh khac nhau cho ra cung mot chuoi AD.
 *
 * @param {NoteContext} context
 * @returns {Uint8Array}
 */
export function noteAssociatedData(context) {
  if (!context || typeof context !== 'object') {
    throw new TypeError('Thieu ngu canh ma hoa {noteId, version, field} (D19).');
  }
  const { noteId, version, field } = context;
  if (typeof noteId !== 'string' || !UUID_V4.test(noteId)) {
    throw new TypeError('noteId phai la UUID v4 chu thuong.');
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('version phai la so nguyen >= 1.');
  }
  if (!NOTE_FIELDS.has(field)) {
    throw new TypeError("field phai la 'title' hoac 'content'.");
  }
  return sodium.from_string(`${NOTE_AD_LABEL}|${field}|${noteId}|${version}`);
}

/**
 * Ma hoa mot truong cua note (tieu de hoac noi dung) bang khoa AEAD 32 byte.
 * Nonce 24 byte ngau nhien moi lan.
 *
 * @param {string} plaintext
 * @param {Uint8Array} key - note-key cua note nay.
 * @param {NoteContext} context - ciphertext se chi giai ma duoc voi DUNG ngu canh nay.
 * @returns {Promise<EncryptedPayload>}
 */
export async function encryptNote(plaintext, key, context) {
  await ready();
  const ad = noteAssociatedData(context);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const plaintextBytes = sodium.from_string(plaintext);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    ad,
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
 * Giai ma mot truong cua note. Throw neu ciphertext bi sua, sai khoa, HOAC ngu canh
 * (noteId, version, field) khong khop voi luc ma hoa.
 *
 * @param {EncryptedPayload} encryptedNote
 * @param {Uint8Array} key
 * @param {NoteContext} context - ngu canh MA CLIENT MONG DOI, khong phai ngu canh server khai.
 * @returns {Promise<string>}
 */
export async function decryptNote(encryptedNote, key, context) {
  await ready();
  const ad = noteAssociatedData(context);
  const nonce = fromBase64(encryptedNote.nonce);
  const ciphertext = fromBase64(encryptedNote.ciphertext);
  const plaintextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    ad,
    nonce,
    key,
  );
  return sodium.to_string(plaintextBytes);
}
