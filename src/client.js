/**
 * client.js
 * ---------
 * Lop "client SDK" cap cao - day la lop C (frontend) se goi truc tiep.
 * C KHONG BAO GIO tu goi kdf/vault/note/sharing hay tu cam vao khai niem
 * Master Key/Vault Key/private key - C chi goi cac ham o day, truyen vao/
 * nhan ve du lieu thuong (chuoi, object thuong).
 *
 * SecureNoteClient nhan vao 1 "transport" - bat ky object nao co du cac ham
 * async: register, getSalt, login, getUserKeys, createNote, listNotes,
 * getNote, shareNote, listSharedWithMe, getShare. Hom nay dung
 * memoryTransport.js (server gia trong bo nho) de tu phat trien/test doc
 * lap voi B. Sau nay B xong backend that, chi can doi transport thanh 1
 * object goi fetch() toi API that - KHONG SUA GI trong file nay ca.
 *
 * Trang thai dang nhap (masterKey, vaultKey, private key...) chi luu trong
 * thuoc tinh rieng cua instance (this._session) - nghia la CHI TON TAI TRONG
 * BO NHO cua tab trinh duyet dang mo, mat khi refresh trang. KHONG BAO GIO
 * ghi cac gia tri nay ra localStorage/sessionStorage - dung nguyen tac da
 * ghi trong README.
 */

const sodium = require('libsodium-wrappers-sumo');
const kdf = require('./kdf');
const vault = require('./vault');
const note = require('./note');
const sharing = require('./sharing');

async function ready() {
  await sodium.ready;
}

class SecureNoteClient {
  constructor(transport) {
    if (!transport) {
      throw new Error('SecureNoteClient can 1 transport (vi du memoryTransport hoac fetch toi API that)');
    }
    this.transport = transport;
    this._session = null;
  }

  _requireSession() {
    if (!this._session) {
      throw new Error('Chua dang nhap - goi register() hoac login() truoc');
    }
    return this._session;
  }

  /** true/false - de C kiem tra nhanh truoc khi hien thi giao dien can dang nhap */
  isLoggedIn() {
    return this._session !== null;
  }

  /** email dang dang nhap, hoac null neu chua dang nhap - de C hien thi len giao dien */
  currentUserEmail() {
    return this._session ? this._session.email : null;
  }

  /**
   * Dang ky tai khoan moi. Tu dong dang nhap luon sau khi dang ky xong
   * (giong hanh vi thuong thay tren cac web thuc te).
   */
  async register(email, password) {
    await ready();

    const salt = kdf.generateSalt();
    const { authKey, masterKey } = await kdf.deriveKeysFromPassword(password, salt);

    const vaultKey = vault.generateVaultKey();
    const wrappedVaultKey = await vault.wrapVaultKey(vaultKey, masterKey);

    const keyPair = await sharing.generateKeyPair();
    const wrappedPrivateKey = await sharing.wrapPrivateKey(keyPair.privateKey, masterKey);

    const signingKeyPair = await sharing.generateSigningKeyPair();
    const wrappedSigningPrivateKey = await sharing.wrapPrivateKey(signingKeyPair.privateKey, masterKey);

    await this.transport.register({
      email,
      saltB64: sodium.to_base64(salt),
      authKeyB64: sodium.to_base64(authKey),
      wrappedVaultKey,
      publicKeyB64: sodium.to_base64(keyPair.publicKey),
      wrappedPrivateKey,
      signingPublicKeyB64: sodium.to_base64(signingKeyPair.publicKey),
      wrappedSigningPrivateKey,
    });

    this._session = {
      email,
      masterKey,
      vaultKey,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      signingPrivateKey: signingKeyPair.privateKey,
      signingPublicKey: signingKeyPair.publicKey,
    };

    return { email };
  }

  /** Dang nhap bang tai khoan da co. Nem loi neu sai email/mat khau. */
  async login(email, password) {
    await ready();

    const saltB64 = await this.transport.getSalt(email);
    const salt = sodium.from_base64(saltB64);
    const { authKey, masterKey } = await kdf.deriveKeysFromPassword(password, salt);

    const record = await this.transport.login({ email, authKeyB64: sodium.to_base64(authKey) });

    const vaultKey = await vault.unwrapVaultKey(record.wrappedVaultKey, masterKey);
    const privateKey = await sharing.unwrapPrivateKey(record.wrappedPrivateKey, masterKey);
    const signingPrivateKey = await sharing.unwrapPrivateKey(record.wrappedSigningPrivateKey, masterKey);

    this._session = {
      email,
      masterKey,
      vaultKey,
      privateKey,
      publicKey: sodium.from_base64(record.publicKeyB64),
      signingPrivateKey,
      signingPublicKey: sodium.from_base64(record.signingPublicKeyB64),
    };

    return { email };
  }

  /** Xoa toan bo khoa khoi bo nho - goi khi nguoi dung bam "Dang xuat" */
  logout() {
    this._session = null;
  }

  /**
   * Doi mat khau. CHI can boc lai Vault Key va cac private key bang Master
   * Key moi - KHONG dung den bat ky note nao, du co hang nghin note (day
   * chinh la loi ich cua key wrapping 2 lop da thiet ke trong vault.js).
   *
   * Yeu cau nhap lai mat khau CU (khong chi dua vao session hien tai) de
   * phong truong hop tab/trinh duyet dang dang nhap bi ai do muon loi dung,
   * ho van phai biet mat khau that moi doi duoc.
   */
  async changePassword(oldPassword, newPassword) {
    await ready();
    const session = this._requireSession();

    // Xac thuc lai bang mat khau CU truoc - goi login() de server tu xac
    // nhan dung mat khau, nem loi ngay neu sai (khong doi gi ca trong TH nay)
    const oldSaltB64 = await this.transport.getSalt(session.email);
    const oldSalt = sodium.from_base64(oldSaltB64);
    const { authKey: oldAuthKey } = await kdf.deriveKeysFromPassword(oldPassword, oldSalt);
    await this.transport.login({ email: session.email, authKeyB64: sodium.to_base64(oldAuthKey) });

    // Sinh salt + Master Key MOI tu mat khau moi
    const newSalt = kdf.generateSalt();
    const { authKey: newAuthKey, masterKey: newMasterKey } = await kdf.deriveKeysFromPassword(
      newPassword,
      newSalt
    );

    // Boc lai Vault Key va 2 private key (ECDH + ky) bang Master Key MOI -
    // Vault Key, private key, va toan bo note KHONG THAY DOI, chi lop boc
    // ngoai cung doi thoi
    const wrappedVaultKey = await vault.wrapVaultKey(session.vaultKey, newMasterKey);
    const wrappedPrivateKey = await sharing.wrapPrivateKey(session.privateKey, newMasterKey);
    const wrappedSigningPrivateKey = await sharing.wrapPrivateKey(session.signingPrivateKey, newMasterKey);

    await this.transport.changePassword({
      email: session.email,
      saltB64: sodium.to_base64(newSalt),
      authKeyB64: sodium.to_base64(newAuthKey),
      wrappedVaultKey,
      wrappedPrivateKey,
      wrappedSigningPrivateKey,
    });

    // Cap nhat lai session dang mo voi Master Key moi (khong can dang nhap lai)
    session.masterKey = newMasterKey;

    return { email: session.email };
  }

  /** Tao note moi, tra ve { noteId } */
  async createNote(text) {
    await ready();
    const session = this._requireSession();

    const noteKey = vault.generateVaultKey();
    const encryptedNote = await note.encryptNote(text, noteKey);
    const wrappedNoteKeyForOwner = await vault.wrapVaultKey(noteKey, session.vaultKey);

    const { noteId } = await this.transport.createNote({
      ownerEmail: session.email,
      nonce: encryptedNote.nonce,
      ciphertext: encryptedNote.ciphertext,
      wrappedNoteKeyForOwner,
    });

    return { noteId };
  }

  /** Danh sach note cua chinh minh (chi metadata: noteId, createdAt - chua giai ma) */
  async listNotes() {
    const session = this._requireSession();
    return this.transport.listNotes(session.email);
  }

  /** Doc noi dung 1 note CUA CHINH MINH, tra ve chuoi text da giai ma */
  async readNote(noteId) {
    await ready();
    const session = this._requireSession();

    const record = await this.transport.getNote(noteId);
    if (record.ownerEmail !== session.email) {
      throw new Error('Ban khong phai chu note nay - dung readSharedNote() cho note duoc chia se toi ban');
    }

    const noteKey = await vault.unwrapVaultKey(record.wrappedNoteKeyForOwner, session.vaultKey);
    return note.decryptNote({ nonce: record.nonce, ciphertext: record.ciphertext }, noteKey);
  }

  /**
   * Chia se 1 note CUA CHINH MINH cho nguoi khac qua email cua ho.
   * Chi boc dung note key cua note nay, KHONG dua Vault Key.
   */
  async shareNote(noteId, recipientEmail) {
    await ready();
    const session = this._requireSession();

    const record = await this.transport.getNote(noteId);
    if (record.ownerEmail !== session.email) {
      throw new Error('Ban khong phai chu note nay, khong the chia se');
    }

    const noteKey = await vault.unwrapVaultKey(record.wrappedNoteKeyForOwner, session.vaultKey);

    const recipientKeys = await this.transport.getUserKeys(recipientEmail);
    const recipientPublicKey = sodium.from_base64(recipientKeys.publicKeyB64);

    const wrapped = await sharing.wrapNoteKeyForRecipient(noteKey, recipientPublicKey, session.signingPrivateKey);

    const { shareId } = await this.transport.shareNote({
      noteId,
      senderEmail: session.email,
      recipientEmail,
      ...wrapped,
    });

    return { shareId };
  }

  /** Danh sach cac goi da duoc chia se TOI minh (chi metadata, chua giai ma) */
  async listSharedWithMe() {
    const session = this._requireSession();
    return this.transport.listSharedWithMe(session.email);
  }

  /**
   * Doc noi dung 1 note duoc NGUOI KHAC chia se toi minh. Tu dong xac minh
   * chu ky cua nguoi gui truoc khi giai ma (xem sharing.js) - neu sai nguoi
   * gui hoac goi tin bi sua doi thi ham nay se throw, khong tra ve noi dung.
   */
  async readSharedNote(shareId) {
    await ready();
    const session = this._requireSession();

    const share = await this.transport.getShare(shareId);
    const senderKeys = await this.transport.getUserKeys(share.senderEmail);
    const senderSigningPublicKey = sodium.from_base64(senderKeys.signingPublicKeyB64);

    const noteKey = await sharing.unwrapNoteKeyFromSender(
      {
        ephemeralPublicKey: share.ephemeralPublicKey,
        nonce: share.nonce,
        ciphertext: share.ciphertext,
        signature: share.signature,
      },
      session.privateKey,
      senderSigningPublicKey
    );

    return note.decryptNote({ nonce: share.noteNonce, ciphertext: share.noteCiphertext }, noteKey);
  }

  /**
   * Lay fingerprint cua 1 user (theo email) de hien thi cho nguoi dung doi
   * chieu thu cong TRUOC KHI chia se - phong ve chong server trao doi public
   * key (xem publicKeyFingerprint trong sharing.js).
   */
  async getFingerprint(email) {
    await ready();
    const keys = await this.transport.getUserKeys(email);
    return {
      email,
      encryptionKeyFingerprint: sharing.publicKeyFingerprint(sodium.from_base64(keys.publicKeyB64)),
      signingKeyFingerprint: sharing.publicKeyFingerprint(sodium.from_base64(keys.signingPublicKeyB64)),
    };
  }
}

module.exports = { SecureNoteClient };