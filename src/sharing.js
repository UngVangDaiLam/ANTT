/**
 * sharing.js
 * ----------
 * Buoc 4 (phan kho nhat): chia se note bang ma hoa lai (hybrid = bat doi xung
 * de trao khoa, doi xung de ma du lieu), dung X25519 (ECDH) + XChaCha20-Poly1305.
 *
 * Moi user co 1 cap khoa X25519 (public/private). Khi A chia se note cho B:
 *   1. A tinh mot "khoa dung chung tam thoi" bang ECDH giua 1 cap khoa ephemeral
 *      (sinh ra dung 1 lan cho lan chia se nay) va public key cua B.
 *   2. A dung khoa dung chung do de boc noteKey (Vault Key hoac khoa rieng cua note).
 *   3. B nhan duoc {ephemeralPublicKey, nonce, ciphertext}, tu tinh lai chinh
 *      khoa dung chung do bang private key cua minh, roi mo ra noteKey.
 *   4. Server chi trung chuyen 3 truong o buoc 3, khong doc duoc gi.
 *
 * Day la mot bien the don gian cua ECIES (Elliptic Curve Integrated Encryption
 * Scheme) - mau thiet ke rat pho bien va da duoc kiem chung.
 *
 * GIOI HAN CAN NEU RO TRONG BAO CAO:
 * - Khong co forward secrecy cho khoa dai han cua user (private key X25519 la
 *   tinh, khong doi) - neu private key lo sau nay, cac goi da chia se truoc do
 *   co the bi giai ma nguoc.
 * - Chua co co che xac thuc "public key nhan duoc dung la cua B" (chong server
 *   trao doi public key) - de xuat: hien thi fingerprint (hash public key) de
 *   nguoi dung doi chieu thu cong, tuong tu "safety number" cua Signal.
 */

const sodium = require('libsodium-wrappers-sumo');

async function ready() {
  await sodium.ready;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/** Sinh cap khoa X25519 cho 1 user (dung khi dang ky tai khoan) */
async function generateKeyPair() {
  await ready();
  const kp = sodium.crypto_box_keypair(); // cap khoa Curve25519, dung duoc cho scalarmult
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Boc private key cua chinh minh bang Master Key truoc khi gui len server luu */
async function wrapPrivateKey(privateKey, masterKey) {
  await ready();
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    privateKey,
    null,
    null,
    nonce,
    masterKey
  );
  return { nonce: sodium.to_base64(nonce), ciphertext: sodium.to_base64(ciphertext) };
}

/** Mo private key da boc, dung sau khi dang nhap va da co masterKey */
async function unwrapPrivateKey(wrapped, masterKey) {
  await ready();
  const nonce = sodium.from_base64(wrapped.nonce);
  const ciphertext = sodium.from_base64(wrapped.ciphertext);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    masterKey
  );
}

/**
 * Dan xuat khoa doi xung dung chung tu ket qua ECDH (X25519).
 * KHONG dung truc tiep sharedSecret lam khoa ma hash them voi 2 public key
 * lien quan de "gan" ngu canh (context binding) - thong le tot khi xay ECIES.
 */
function deriveSharedKey(sharedSecret, ephemeralPublicKey, recipientPublicKey) {
  return sodium.crypto_generichash(
    32,
    concatBytes(sharedSecret, ephemeralPublicKey, recipientPublicKey)
  );
}

/** A dung ham nay de boc noteKey gui cho B, chi can public key cua B */
async function wrapNoteKeyForRecipient(noteKey, recipientPublicKey) {
  await ready();
  const ephemeral = sodium.crypto_box_keypair();
  const sharedSecret = sodium.crypto_scalarmult(ephemeral.privateKey, recipientPublicKey);
  const wrapKey = deriveSharedKey(sharedSecret, ephemeral.publicKey, recipientPublicKey);
  sodium.memzero(sharedSecret);

  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    noteKey,
    null,
    null,
    nonce,
    wrapKey
  );
  sodium.memzero(wrapKey);

  return {
    ephemeralPublicKey: sodium.to_base64(ephemeral.publicKey),
    nonce: sodium.to_base64(nonce),
    ciphertext: sodium.to_base64(ciphertext),
  };
}

/** B dung private key cua minh de mo goi noteKey nhan tu A */
async function unwrapNoteKeyFromSender(wrapped, myPrivateKey) {
  await ready();
  const ephemeralPublicKey = sodium.from_base64(wrapped.ephemeralPublicKey);
  const nonce = sodium.from_base64(wrapped.nonce);
  const ciphertext = sodium.from_base64(wrapped.ciphertext);

  const sharedSecret = sodium.crypto_scalarmult(myPrivateKey, ephemeralPublicKey);
  const myPublicKey = sodium.crypto_scalarmult_base(myPrivateKey);
  const wrapKey = deriveSharedKey(sharedSecret, ephemeralPublicKey, myPublicKey);
  sodium.memzero(sharedSecret);

  const noteKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    wrapKey
  );
  sodium.memzero(wrapKey);
  return noteKey;
}

/**
 * Tạo "fingerprint" ngắn, dễ đọc từ public key, dùng để 2 người đối chiếu
 * thủ công (qua điện thoại/gặp mặt) nhằm xác nhận không bị server tráo khóa.
 * Không thay thế được xác thực mật mã thật sự, chỉ là lớp phòng vệ thủ công.
 */
function publicKeyFingerprint(publicKey) {
  const hash = sodium.crypto_generichash(16, publicKey);
  const hex = sodium.to_hex(hash);
  return hex.match(/.{1,4}/g).join(' ');
}

module.exports = {
  generateKeyPair,
  wrapPrivateKey,
  unwrapPrivateKey,
  wrapNoteKeyForRecipient,
  unwrapNoteKeyFromSender,
  publicKeyFingerprint,
};
