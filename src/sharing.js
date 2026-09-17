/**
 * sharing.js
 * ----------
 * Buoc 4 (phan kho nhat): chia se note bang ma hoa lai (hybrid = bat doi xung
 * de trao khoa, doi xung de ma du lieu), dung X25519 (ECDH) + XChaCha20-Poly1305.
 *
 * Moi user co 1 cap khoa X25519 (public/private) DUNG DE MA HOA (ECDH), va
 * rieng mot cap khoa Ed25519 (public/private) DUNG DE KY SO (chu khong dung
 * chung 1 cap khoa cho ca 2 viec - do la anti-pattern trong crypto, vi dung
 * chung khoa cho ma hoa va ky lam yeu di gia dinh bao mat cua ca hai co che).
 *
 * Khi A chia se note cho B:
 *   1. A tinh mot "khoa dung chung tam thoi" bang ECDH giua 1 cap khoa ephemeral
 *      (sinh ra dung 1 lan cho lan chia se nay) va public key (ECDH) cua B.
 *   2. A dung khoa dung chung do de boc noteKey (Vault Key hoac khoa rieng cua note).
 *   3. A KY SO (Ed25519) tren toan bo goi tin da tao ra (ephemeralPublicKey,
 *      nonce, ciphertext, publicKey ECDH cua B) bang private key ky cua chinh A.
 *      Day la phan moi them de khac phuc gioi han "chua xac thuc nguoi gui".
 *   4. B nhan duoc {ephemeralPublicKey, nonce, ciphertext, signature}, TRUOC
 *      TIEN xac minh chu ky bang public key ky cua A (da co qua kenh dang tin
 *      cay - vi du doi chieu fingerprint truoc do), NEU SAI THI TU CHOI NGAY,
 *      khong giai ma. Neu dung, moi tinh lai khoa dung chung bang private key
 *      cua minh, roi mo ra noteKey.
 *   5. Server chi trung chuyen cac truong o buoc 3, khong doc duoc gi va cung
 *      khong the gia mao nguoi gui vi khong co private key ky cua A.
 *
 * Day la mot bien the don gian cua ECIES (Elliptic Curve Integrated Encryption
 * Scheme) ket hop chu ky so - mau thiet ke rat pho bien va da duoc kiem chung.
 *
 * GIOI HAN CAN NEU RO TRONG BAO CAO:
 * - Khong co forward secrecy cho khoa dai han cua user (private key X25519 la
 *   tinh, khong doi) - neu private key lo sau nay, cac goi da chia se truoc do
 *   co the bi giai ma nguoc.
 * - Chu ky so (buoc 3-4) chi chung minh "nguoi giu private key ky nay da tao
 *   goi tin nay", nhung KHONG tu dong chung minh public key ky do that su la
 *   cua A - van can mot kenh dang tin cay de trao doi public key ky ban dau
 *   (vi du doi chieu publicKeyFingerprint() qua dien thoai, giong Signal safety
 *   number). Neu ke tan cong tra public key ky ngay tu dau (MITM luc dang ky/
 *   trao doi lien lac), chu ky van "hop le" nhung voi danh tinh gia.
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

/** Sinh cap khoa X25519 cho 1 user, dung cho ECDH khi chia se (dung khi dang ky tai khoan) */
async function generateKeyPair() {
  await ready();
  const kp = sodium.crypto_box_keypair(); // cap khoa Curve25519, dung duoc cho scalarmult
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/**
 * Sinh cap khoa Ed25519 RIENG de KY SO, tach biet hoan toan voi cap khoa
 * ECDH o tren. Dung khi dang ky tai khoan, giong nhu generateKeyPair().
 */
async function generateSigningKeyPair() {
  await ready();
  const kp = sodium.crypto_sign_keypair(); // Ed25519 - chi dung de ky/xac minh, KHONG dung de ma hoa
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/**
 * Boc private key (ECDH hoac ky so, ham nay dung chung duoc vi chi la boc 1
 * mang byte bang AEAD) cua chinh minh bang Master Key truoc khi gui len server luu
 */
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

/**
 * A dung ham nay de boc noteKey gui cho B, VA ky so len toan bo goi tin bang
 * private key ky (Ed25519) cua chinh A - de B xac minh dung la A gui, khong
 * phai ai khac gia mao (ke ca khi server bi chiem quyen va sua doi ban tin).
 *
 * senderSigningPrivateKey: private key Ed25519 cua NGUOI GUI (A), lay tu
 * generateSigningKeyPair() luc dang ky, KHONG PHAI private key ECDH.
 */
async function wrapNoteKeyForRecipient(noteKey, recipientPublicKey, senderSigningPrivateKey) {
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

  // Ky so tren toan bo goi tin (ephemeralPublicKey + nonce + ciphertext +
  // recipientPublicKey) - gan chu ky voi DUNG goi tin nay va DUNG nguoi nhan
  // nay, tranh truong hop mot goi da ky hop le bi dem "gan" sang ngu canh khac.
  const signedMessage = concatBytes(
    ephemeral.publicKey,
    nonce,
    ciphertext,
    recipientPublicKey
  );
  const signature = sodium.crypto_sign_detached(signedMessage, senderSigningPrivateKey);

  return {
    ephemeralPublicKey: sodium.to_base64(ephemeral.publicKey),
    nonce: sodium.to_base64(nonce),
    ciphertext: sodium.to_base64(ciphertext),
    signature: sodium.to_base64(signature),
  };
}

/**
 * B dung private key cua minh de mo goi noteKey nhan tu A, SAU KHI xac minh
 * chu ky bang public key ky (Ed25519) cua A. Neu chu ky sai (sai nguoi gui,
 * hoac ban tin bi sua doi tren duong truyen) thi throw NGAY, khong giai ma.
 *
 * senderSigningPublicKey: public key Ed25519 cua NGUOI GUI (A) - B phai co
 * duoc key nay qua kenh dang tin cay (vi du doi chieu fingerprint truoc do).
 */
async function unwrapNoteKeyFromSender(wrapped, myPrivateKey, senderSigningPublicKey) {
  await ready();
  const ephemeralPublicKey = sodium.from_base64(wrapped.ephemeralPublicKey);
  const nonce = sodium.from_base64(wrapped.nonce);
  const ciphertext = sodium.from_base64(wrapped.ciphertext);
  const signature = sodium.from_base64(wrapped.signature);

  const myPublicKey = sodium.crypto_scalarmult_base(myPrivateKey);

  // Xac minh chu ky TRUOC KHI giai ma - tu choi som neu khong dung nguoi gui
  const signedMessage = concatBytes(ephemeralPublicKey, nonce, ciphertext, myPublicKey);
  const isValidSignature = sodium.crypto_sign_verify_detached(
    signature,
    signedMessage,
    senderSigningPublicKey
  );
  if (!isValidSignature) {
    throw new Error('Chu ky khong hop le: goi tin khong den tu dung nguoi gui, hoac da bi sua doi.');
  }

  const sharedSecret = sodium.crypto_scalarmult(myPrivateKey, ephemeralPublicKey);
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
 * Tao "fingerprint" ngan gon, de doc cua mot public key (ECDH hoac ky so deu
 * dung duoc) de 2 nguoi doi chieu thu cong qua kenh khac (dien thoai, gap mat)
 * truoc khi tin tuong dung public key do de chia se hoac xac minh chu ky -
 * tuong tu "safety number" cua Signal. Day la lop phong ve THU CONG, khong
 * phai xac thuc mat ma tu dong.
 */
function publicKeyFingerprint(publicKey) {
  const hash = sodium.crypto_generichash(16, publicKey);
  const hex = sodium.to_hex(hash);
  return hex.match(/.{1,4}/g).join(' ');
}

module.exports = {
  generateKeyPair,
  generateSigningKeyPair,
  wrapPrivateKey,
  unwrapPrivateKey,
  wrapNoteKeyForRecipient,
  unwrapNoteKeyFromSender,
  publicKeyFingerprint,
};