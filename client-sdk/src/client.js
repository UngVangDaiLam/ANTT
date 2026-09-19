/**
 * client.js (package @secure-note/client-sdk)
 * ---------------------------------------------
 * Lop "client SDK" cap cao - day la lop giao dien web (Phan Bao) se goi truc
 * tiep. Giao dien KHONG BAO GIO tu goi @secure-note/crypto hay tu cam vao
 * khai niem Master Key/Vault Key/private key - chi goi cac ham public o day,
 * truyen vao/nhan ve du lieu thuong (chuoi, object thuong).
 *
 * SecureNoteClient nhan vao 1 "transport" - bat ky object nao co du cac ham
 * async trong Transport (xem transportType.js). Dung memoryTransport.js (server
 * gia trong bo nho) de tu phat trien/test doc lap voi backend. Khi backend that
 * xong, chi can doi transport thanh createFetchTransport(...) - KHONG SUA GI
 * trong file nay ca.
 *
 * Trang thai dang nhap (masterKey, vaultKey, private key...) chi luu trong
 * thuoc tinh rieng cua instance (this._session) - nghia la CHI TON TAI TRONG
 * BO NHO cua tab trinh duyet dang mo, mat khi refresh trang. KHONG BAO GIO ghi
 * cac gia tri nay ra localStorage/sessionStorage.
 */

import { getSodium, kdf, vault, note, sharing } from '@secure-notes/crypto';

// client-sdk KHONG tu import libsodium-wrappers-sumo: moi thao tac ma hoa di
// qua @secure-notes/crypto (dung export getSodium() co san) de chi mot cho
// duy nhat trong repo cham vao thu vien libsodium.
let sodium;

async function ready() {
  sodium = await getSodium();
}

/**
 * @typedef {object} SecureNoteSession
 * @property {string} email
 * @property {Uint8Array} masterKey
 * @property {Uint8Array} vaultKey
 * @property {Uint8Array} privateKey
 * @property {Uint8Array} publicKey
 * @property {Uint8Array} signingPrivateKey
 * @property {Uint8Array} signingPublicKey
 */

export class SecureNoteClient {
  /**
   * @param {import('./transportType.js').Transport} transport - vi du createMemoryTransport()
   *   hoac createFetchTransport(baseUrl).
   */
  constructor(transport) {
    if (!transport) {
      throw new Error(
        'SecureNoteClient can 1 transport (vi du memoryTransport hoac fetch toi API that)',
      );
    }
    this.transport = transport;
    /** @type {SecureNoteSession | null} */
    this._session = null;
  }

  _requireSession() {
    if (!this._session) {
      throw new Error('Chua dang nhap - goi register() hoac login() truoc');
    }
    return this._session;
  }

  /**
   * @returns {boolean} true neu dang co phien dang nhap - de giao dien kiem tra
   *   nhanh truoc khi hien thi man hinh can dang nhap.
   */
  isLoggedIn() {
    return this._session !== null;
  }

  /** @returns {string | null} email dang dang nhap, hoac null neu chua dang nhap. */
  currentUserEmail() {
    return this._session ? this._session.email : null;
  }

  /**
   * Dang ky tai khoan moi. Tu dong dang nhap luon sau khi dang ky xong.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{email: string}>}
   */
  async register(email, password) {
    await ready();
    const normalizedEmail = email.trim().toLowerCase();

    const salt = kdf.generateSalt();
    const { authKey, masterKey } = await kdf.deriveKeysFromPassword(password, salt);

    const vaultKey = vault.generateVaultKey();
    const wrappedVaultKey = await vault.wrapVaultKey(vaultKey, masterKey);

    const keyPair = await sharing.generateKeyPair();
    const wrappedPrivateKey = await sharing.wrapPrivateKey(keyPair.privateKey, masterKey);

    const signingKeyPair = await sharing.generateSigningKeyPair();
    const wrappedSigningPrivateKey = await sharing.wrapPrivateKey(
      signingKeyPair.privateKey,
      masterKey,
    );

    await this.transport.register({
      email: normalizedEmail,
      saltB64: sodium.to_base64(salt),
      authKeyB64: sodium.to_base64(authKey),
      wrappedVaultKey,
      publicKeyB64: sodium.to_base64(keyPair.publicKey),
      wrappedPrivateKey,
      signingPublicKeyB64: sodium.to_base64(signingKeyPair.publicKey),
      wrappedSigningPrivateKey,
    });

    this._session = {
      email: normalizedEmail,
      masterKey,
      vaultKey,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      signingPrivateKey: signingKeyPair.privateKey,
      signingPublicKey: signingKeyPair.publicKey,
    };

    return { email: normalizedEmail };
  }

  /**
   * Dang nhap bang tai khoan da co. Nem loi neu sai email/mat khau.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{email: string}>}
   */
  async login(email, password) {
    await ready();
    const normalizedEmail = email.trim().toLowerCase();

    const saltB64 = await this.transport.getSalt(normalizedEmail);
    const salt = sodium.from_base64(saltB64);
    const { authKey, masterKey } = await kdf.deriveKeysFromPassword(password, salt);

    const record = await this.transport.login({
      email: normalizedEmail,
      authKeyB64: sodium.to_base64(authKey),
    });

    const vaultKey = await vault.unwrapVaultKey(record.wrappedVaultKey, masterKey);
    const privateKey = await sharing.unwrapPrivateKey(record.wrappedPrivateKey, masterKey);
    const signingPrivateKey = await sharing.unwrapPrivateKey(
      record.wrappedSigningPrivateKey,
      masterKey,
    );

    this._session = {
      email: normalizedEmail,
      masterKey,
      vaultKey,
      privateKey,
      publicKey: sodium.from_base64(record.publicKeyB64),
      signingPrivateKey,
      signingPublicKey: sodium.from_base64(record.signingPublicKeyB64),
    };

    return { email: normalizedEmail };
  }

  /**
   * Dang xuat: xoa khoa khoi bo nho ngay lap tuc (sodium.memzero) truoc khi bo
   * tham chieu, thay vi chi gan null va cho garbage collector don dep - giam
   * thoi gian khoa nhay cam con ton tai trong RAM.
   */
  logout() {
    if (this._session) {
      sodium.memzero(this._session.masterKey);
      sodium.memzero(this._session.vaultKey);
      sodium.memzero(this._session.privateKey);
      sodium.memzero(this._session.signingPrivateKey);
    }
    this._session = null;
  }

  /**
   * Doi mat khau. CHI can boc lai Vault Key va cac private key bang Master Key
   * moi - KHONG dung den bat ky note nao, du co hang nghin note (day chinh la
   * loi ich cua key wrapping 2 lop da thiet ke trong @secure-note/crypto/vault.js).
   *
   * Yeu cau nhap lai mat khau CU (khong chi dua vao session hien tai) de phong
   * truong hop tab/trinh duyet dang dang nhap bi ai do muon loi dung, ho van
   * phai biet mat khau that moi doi duoc.
   *
   * @param {string} oldPassword
   * @param {string} newPassword
   * @returns {Promise<{email: string}>}
   */
  async changePassword(oldPassword, newPassword) {
    await ready();
    const session = this._requireSession();

    const oldSaltB64 = await this.transport.getSalt(session.email);
    const oldSalt = sodium.from_base64(oldSaltB64);
    const { authKey: oldAuthKey } = await kdf.deriveKeysFromPassword(oldPassword, oldSalt);
    await this.transport.login({ email: session.email, authKeyB64: sodium.to_base64(oldAuthKey) });

    const newSalt = kdf.generateSalt();
    const { authKey: newAuthKey, masterKey: newMasterKey } = await kdf.deriveKeysFromPassword(
      newPassword,
      newSalt,
    );

    const wrappedVaultKey = await vault.wrapVaultKey(session.vaultKey, newMasterKey);
    const wrappedPrivateKey = await sharing.wrapPrivateKey(session.privateKey, newMasterKey);
    const wrappedSigningPrivateKey = await sharing.wrapPrivateKey(
      session.signingPrivateKey,
      newMasterKey,
    );

    await this.transport.changePassword({
      email: session.email,
      saltB64: sodium.to_base64(newSalt),
      authKeyB64: sodium.to_base64(newAuthKey),
      wrappedVaultKey,
      wrappedPrivateKey,
      wrappedSigningPrivateKey,
    });

    sodium.memzero(session.masterKey);
    session.masterKey = newMasterKey;

    return { email: session.email };
  }

  /**
   * Tao note moi.
   * @param {string} text
   * @returns {Promise<{noteId: string}>}
   */
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

  /** @returns {Promise<Array<{noteId: string, createdAt: number|string}>>} */
  async listNotes() {
    const session = this._requireSession();
    return this.transport.listNotes(session.email);
  }

  /**
   * Doc noi dung 1 note CUA CHINH MINH.
   * @param {string} noteId
   * @returns {Promise<string>}
   */
  async readNote(noteId) {
    await ready();
    const session = this._requireSession();

    const record = await this.transport.getNote(noteId);
    if (record.ownerEmail !== session.email) {
      throw new Error(
        'Ban khong phai chu note nay - dung readSharedNote() cho note duoc chia se toi ban',
      );
    }

    const noteKey = await vault.unwrapVaultKey(record.wrappedNoteKeyForOwner, session.vaultKey);
    return note.decryptNote({ nonce: record.nonce, ciphertext: record.ciphertext }, noteKey);
  }

  /**
   * Chia se 1 note CUA CHINH MINH cho nguoi khac qua email cua ho. Chi boc
   * dung note key cua note nay, KHONG dua Vault Key.
   *
   * @param {string} noteId
   * @param {string} recipientEmail
   * @returns {Promise<{shareId: string}>}
   */
  async shareNote(noteId, recipientEmail) {
    await ready();
    const session = this._requireSession();
    const normalizedRecipient = recipientEmail.trim().toLowerCase();

    const record = await this.transport.getNote(noteId);
    if (record.ownerEmail !== session.email) {
      throw new Error('Ban khong phai chu note nay, khong the chia se');
    }

    const noteKey = await vault.unwrapVaultKey(record.wrappedNoteKeyForOwner, session.vaultKey);

    const recipientKeys = await this.transport.getUserKeys(normalizedRecipient);
    const recipientPublicKey = sodium.from_base64(recipientKeys.publicKeyB64);

    const wrapped = await sharing.wrapNoteKeyForRecipient(
      noteKey,
      recipientPublicKey,
      session.signingPrivateKey,
    );

    const { shareId } = await this.transport.shareNote({
      noteId,
      senderEmail: session.email,
      recipientEmail: normalizedRecipient,
      ...wrapped,
    });

    return { shareId };
  }

  /** @returns {Promise<Array<{shareId: string, noteId: string, senderEmail: string, createdAt: number|string}>>} */
  async listSharedWithMe() {
    const session = this._requireSession();
    return this.transport.listSharedWithMe(session.email);
  }

  /**
   * Doc noi dung 1 note duoc NGUOI KHAC chia se toi minh. Tu dong xac minh chu
   * ky cua nguoi gui truoc khi giai ma - neu sai nguoi gui hoac goi tin bi sua
   * doi thi ham nay se throw, khong tra ve noi dung.
   *
   * @param {string} shareId
   * @returns {Promise<string>}
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
      senderSigningPublicKey,
    );

    return note.decryptNote({ nonce: share.noteNonce, ciphertext: share.noteCiphertext }, noteKey);
  }

  /**
   * Lay fingerprint cua 1 user (theo email) de hien thi cho nguoi dung doi
   * chieu thu cong TRUOC KHI chia se - phong ve chong server trao doi public
   * key gia.
   *
   * @param {string} email
   * @returns {Promise<{email: string, encryptionKeyFingerprint: string, signingKeyFingerprint: string}>}
   */
  async getFingerprint(email) {
    await ready();
    const normalizedEmail = email.trim().toLowerCase();
    const keys = await this.transport.getUserKeys(normalizedEmail);
    return {
      email: normalizedEmail,
      encryptionKeyFingerprint: sharing.publicKeyFingerprint(sodium.from_base64(keys.publicKeyB64)),
      signingKeyFingerprint: sharing.publicKeyFingerprint(
        sodium.from_base64(keys.signingPublicKeyB64),
      ),
    };
  }
}
