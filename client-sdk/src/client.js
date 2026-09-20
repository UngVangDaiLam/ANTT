/**
 * client.js (package @secure-notes/client-sdk)
 * ---------------------------------------------
 * Lớp "client SDK" cấp cao — đây là lớp mà giao diện web gọi trực tiếp. Giao
 * diện KHÔNG bao giờ tự gọi @secure-notes/crypto và không phải biết tới Master
 * Key / Vault Key / note key: chỉ gọi các hàm ở đây, truyền vào và nhận về dữ
 * liệu thường (chuỗi, object thường).
 *
 * SecureNoteClient nhận vào một "transport" (xem transportType.js):
 * createMemoryTransport() để tự phát triển/test, createFetchTransport() khi nối
 * vào server thật. Đổi transport KHÔNG phải sửa gì trong file này.
 *
 * Trạng thái đăng nhập (masterKey, vaultKey, private key...) chỉ nằm trong
 * thuộc tính riêng của instance — nghĩa là CHỈ TỒN TẠI TRONG BỘ NHỚ của tab
 * đang mở, mất khi refresh. KHÔNG bao giờ ghi ra localStorage/sessionStorage.
 */

import { getSodium, kdf, vault, note, sharing, toBase64, fromBase64 } from '@secure-notes/crypto';
import { KDF_DEFAULTS, LIMITS, NOTE_VERSION_START, normalizeEmail } from '@secure-notes/shared';

// client-sdk KHÔNG tự import libsodium-wrappers-sumo: mọi thao tác mật mã đi
// qua @secure-notes/crypto để chỉ một chỗ duy nhất trong repo chạm vào thư viện.
let sodium;

async function ready() {
  sodium = await getSodium();
}

/**
 * @typedef {object} SecureNoteSession
 * @property {string} email
 * @property {Uint8Array} masterKey
 * @property {Uint8Array} vaultKey
 * @property {Uint8Array} x25519PrivateKey
 * @property {Uint8Array} x25519PublicKey
 * @property {Uint8Array} ed25519PrivateKey
 * @property {Uint8Array} ed25519PublicKey
 */

export class SecureNoteClient {
  /**
   * @param {import('./transportType.js').Transport} transport — ví dụ
   *   createMemoryTransport() hoặc createFetchTransport().
   */
  constructor(transport) {
    if (!transport) {
      throw new Error('SecureNoteClient cần một transport (memoryTransport hoặc fetchTransport)');
    }
    this.transport = transport;
    /** @type {SecureNoteSession | null} */
    this._session = null;
  }

  _requireSession() {
    if (!this._session) {
      throw new Error('Chưa đăng nhập — gọi register() hoặc login() trước');
    }
    return this._session;
  }

  /** @returns {boolean} để giao diện kiểm tra nhanh trước khi hiện màn hình cần đăng nhập. */
  isLoggedIn() {
    return this._session !== null;
  }

  /** @returns {string | null} email đang đăng nhập, hoặc null. */
  currentUserEmail() {
    return this._session ? this._session.email : null;
  }

  /**
   * Đăng ký tài khoản mới rồi đăng nhập luôn.
   *
   * Server KHÔNG tạo phiên khi đăng ký (D36), nên hàm này gọi tiếp /api/login.
   * Nó dùng lại authKey vừa dẫn xuất thay vì chạy Argon2id lần thứ hai — Argon2id
   * với 64 MB bộ nhớ là thao tác đắt nhất trong cả luồng.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{email: string}>}
   */
  async register(email, password) {
    await ready();
    const normalizedEmail = normalizeEmail(email);

    const salt = kdf.generateSalt();
    const kdfParams = { ...KDF_DEFAULTS };
    const { authKey, masterKey } = await kdf.deriveKeysFromPassword(password, salt, kdfParams);

    const vaultKey = vault.generateVaultKey();
    const wrappedVaultKey = await vault.wrapVaultKey(vaultKey, masterKey);

    const x25519 = await sharing.generateKeyPair();
    const wrappedX25519PrivateKey = await sharing.wrapPrivateKey(x25519.privateKey, masterKey);

    const ed25519 = await sharing.generateSigningKeyPair();
    const wrappedEd25519PrivateKey = await sharing.wrapPrivateKey(ed25519.privateKey, masterKey);

    const authKeyB64 = toBase64(authKey);
    await this.transport.register({
      email: normalizedEmail,
      salt: toBase64(salt),
      kdfParams,
      authKey: authKeyB64,
      wrappedVaultKey,
      x25519PublicKey: toBase64(x25519.publicKey),
      ed25519PublicKey: toBase64(ed25519.publicKey),
      wrappedX25519PrivateKey,
      wrappedEd25519PrivateKey,
    });

    await this.transport.login({ email: normalizedEmail, authKey: authKeyB64 });

    this._session = {
      email: normalizedEmail,
      masterKey,
      vaultKey,
      x25519PrivateKey: x25519.privateKey,
      x25519PublicKey: x25519.publicKey,
      ed25519PrivateKey: ed25519.privateKey,
      ed25519PublicKey: ed25519.publicKey,
    };

    return { email: normalizedEmail };
  }

  /**
   * Đăng nhập. Ném lỗi nếu sai email/mật khẩu.
   *
   * Dùng đúng kdfParams mà server trả kèm salt (D13), KHÔNG dùng hằng số mặc
   * định hiện tại — nếu không, tài khoản đăng ký trước khi tham số Argon2id
   * được tăng sẽ dẫn xuất ra sai khóa.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{email: string}>}
   */
  async login(email, password) {
    await ready();
    const normalizedEmail = normalizeEmail(email);

    const { salt, kdfParams } = await this.transport.getSalt(normalizedEmail);
    const { authKey, masterKey } = await kdf.deriveKeysFromPassword(
      password,
      fromBase64(salt),
      kdfParams,
    );

    const account = await this.transport.login({
      email: normalizedEmail,
      authKey: toBase64(authKey),
    });

    const vaultKey = await vault.unwrapVaultKey(account.wrappedVaultKey, masterKey);
    const x25519PrivateKey = await sharing.unwrapPrivateKey(
      account.wrappedX25519PrivateKey,
      masterKey,
    );
    const ed25519PrivateKey = await sharing.unwrapPrivateKey(
      account.wrappedEd25519PrivateKey,
      masterKey,
    );

    this._session = {
      email: account.email,
      masterKey,
      vaultKey,
      x25519PrivateKey,
      x25519PublicKey: fromBase64(account.x25519PublicKey),
      ed25519PrivateKey,
      ed25519PublicKey: fromBase64(account.ed25519PublicKey),
    };

    return { email: account.email };
  }

  /**
   * Đăng xuất: hủy phiên ở server (D26) rồi xóa khóa khỏi bộ nhớ bằng
   * sodium.memzero, thay vì chỉ gán null và chờ garbage collector — giảm thời
   * gian khóa nhạy cảm còn nằm trong RAM.
   *
   * Khóa được xóa kể cả khi gọi server thất bại (mất mạng), vì xóa khóa cục bộ
   * là việc quan trọng hơn.
   */
  async logout() {
    try {
      await this.transport.logout();
    } finally {
      if (this._session) {
        sodium.memzero(this._session.masterKey);
        sodium.memzero(this._session.vaultKey);
        sodium.memzero(this._session.x25519PrivateKey);
        sodium.memzero(this._session.ed25519PrivateKey);
      }
      this._session = null;
    }
  }

  /**
   * Đổi mật khẩu. CHỈ bọc lại Vault Key và hai private key bằng Master Key mới —
   * KHÔNG đụng tới note nào, dù có hàng nghìn note. Đó chính là lợi ích của
   * key wrapping hai lớp trong crypto/src/vault.js.
   *
   * Yêu cầu nhập lại mật khẩu CŨ (D25): server kiểm tra authKey cũ, nên người
   * mượn được tab đang đăng nhập vẫn không đổi được mật khẩu.
   *
   * @param {string} oldPassword
   * @param {string} newPassword
   * @returns {Promise<{email: string}>}
   */
  async changePassword(oldPassword, newPassword) {
    await ready();
    const session = this._requireSession();

    const { salt: oldSalt, kdfParams: oldKdfParams } = await this.transport.getSalt(session.email);
    const { authKey: oldAuthKey } = await kdf.deriveKeysFromPassword(
      oldPassword,
      fromBase64(oldSalt),
      oldKdfParams,
    );

    const newSalt = kdf.generateSalt();
    const kdfParams = { ...KDF_DEFAULTS };
    const { authKey: newAuthKey, masterKey: newMasterKey } = await kdf.deriveKeysFromPassword(
      newPassword,
      newSalt,
      kdfParams,
    );

    await this.transport.changePassword({
      oldAuthKey: toBase64(oldAuthKey),
      salt: toBase64(newSalt),
      kdfParams,
      authKey: toBase64(newAuthKey),
      wrappedVaultKey: await vault.wrapVaultKey(session.vaultKey, newMasterKey),
      wrappedX25519PrivateKey: await sharing.wrapPrivateKey(session.x25519PrivateKey, newMasterKey),
      wrappedEd25519PrivateKey: await sharing.wrapPrivateKey(
        session.ed25519PrivateKey,
        newMasterKey,
      ),
    });

    sodium.memzero(session.masterKey);
    session.masterKey = newMasterKey;

    return { email: session.email };
  }

  /**
   * Tạo note mới. Tiêu đề và nội dung được mã hóa RIÊNG bằng cùng một note key
   * (D21), để API danh sách trả về tiêu đề mà không phải trả nội dung.
   *
   * @param {{title: string, content: string}} input
   * @returns {Promise<{id: string, version: number, updatedAt: string}>}
   */
  async createNote({ title, content }) {
    await ready();
    const session = this._requireSession();
    assertPlaintextSize(content);

    // D17: id do client sinh vì nó sẽ nằm trong Associated Data của ciphertext.
    const id = globalThis.crypto.randomUUID();
    const noteKey = vault.generateVaultKey();

    const payload = {
      id,
      version: NOTE_VERSION_START,
      encryptedTitle: await note.encryptNote(title, noteKey),
      encryptedContent: await note.encryptNote(content, noteKey),
      wrappedNoteKey: await vault.wrapVaultKey(noteKey, session.vaultKey),
    };
    sodium.memzero(noteKey);

    return this.transport.createNote(payload);
  }

  /**
   * Danh sách note của mình, tiêu đề đã giải mã sẵn. Nội dung KHÔNG được tải về
   * ở đây — gọi readNote() khi người dùng thật sự mở một note.
   *
   * @returns {Promise<Array<{id: string, version: number, title: string, updatedAt: string}>>}
   */
  async listNotes() {
    await ready();
    const session = this._requireSession();
    const items = await this.transport.listNotes();

    return Promise.all(
      items.map(async (item) => {
        const noteKey = await vault.unwrapVaultKey(item.wrappedNoteKey, session.vaultKey);
        const title = await note.decryptNote(item.encryptedTitle, noteKey);
        sodium.memzero(noteKey);
        return { id: item.id, version: item.version, title, updatedAt: item.updatedAt };
      }),
    );
  }

  /**
   * Đọc một note: của chính mình, hoặc được người khác chia sẻ cho mình (D22 —
   * cả hai đều đọc từ GET /api/notes/:id, server không sao chép ciphertext).
   *
   * Với note được chia sẻ, chữ ký Ed25519 của người gửi được xác minh TRƯỚC KHI
   * giải mã; sai chữ ký thì ném lỗi và không trả về nội dung nào.
   *
   * @param {string} noteId
   * @returns {Promise<{id: string, version: number, title: string, content: string,
   *   updatedAt: string, sharedBy: string | null}>}
   */
  async readNote(noteId) {
    await ready();
    const session = this._requireSession();
    const record = await this.transport.getNote(noteId);

    let noteKey;
    let sharedBy = null;
    if (record.wrappedNoteKey) {
      noteKey = await vault.unwrapVaultKey(record.wrappedNoteKey, session.vaultKey);
    } else if (record.share) {
      const senderKeys = await this.transport.getUserKeys(record.share.senderEmail);
      noteKey = await sharing.unwrapNoteKeyFromSender(
        record.share.sharePackage,
        session.x25519PrivateKey,
        fromBase64(senderKeys.ed25519PublicKey),
      );
      sharedBy = record.share.senderEmail;
    } else {
      // Server đúng đắn luôn trả một trong hai. Thiếu cả hai là dấu hiệu server
      // lỗi hoặc bị can thiệp — từ chối thay vì đoán.
      throw new Error('Server không trả về khóa để mở note này, từ chối xử lý tiếp.');
    }

    const title = await note.decryptNote(record.encryptedTitle, noteKey);
    const content = await note.decryptNote(record.encryptedContent, noteKey);
    sodium.memzero(noteKey);

    return {
      id: record.id,
      version: record.version,
      title,
      content,
      updatedAt: record.updatedAt,
      sharedBy,
    };
  }

  /**
   * Chia sẻ một note của mình cho người khác. Chỉ bọc đúng note key của note
   * này cho người nhận, KHÔNG bao giờ đưa Vault Key.
   *
   * @param {string} noteId
   * @param {string} recipientEmail
   * @returns {Promise<{id: string}>}
   */
  async shareNote(noteId, recipientEmail) {
    await ready();
    const session = this._requireSession();
    const normalizedRecipient = normalizeEmail(recipientEmail);

    const record = await this.transport.getNote(noteId);
    if (!record.wrappedNoteKey) {
      throw new Error('Bạn không phải chủ note này, không thể chia sẻ.');
    }
    const noteKey = await vault.unwrapVaultKey(record.wrappedNoteKey, session.vaultKey);

    const recipientKeys = await this.transport.getUserKeys(normalizedRecipient);
    const sharePackage = await sharing.wrapNoteKeyForRecipient(
      noteKey,
      fromBase64(recipientKeys.x25519PublicKey),
      session.ed25519PrivateKey,
    );
    sodium.memzero(noteKey);

    return this.transport.shareNote(noteId, {
      recipientEmail: normalizedRecipient,
      sharePackage,
    });
  }

  /**
   * Các note người khác đã chia sẻ cho mình. Trả về tham chiếu; gọi readNote(noteId)
   * để đọc nội dung.
   *
   * @returns {Promise<Array<{id: string, noteId: string, senderEmail: string, createdAt: string}>>}
   */
  async listSharedWithMe() {
    this._requireSession();
    return this.transport.listSharedWithMe();
  }

  /**
   * Fingerprint khóa công khai của một người, để hai bên đối chiếu thủ công qua
   * kênh khác (điện thoại, gặp mặt) TRƯỚC KHI chia sẻ — phòng trường hợp server
   * tráo khóa công khai. Đây là lớp phòng vệ thủ công, không phải xác thực tự động.
   *
   * @param {string} email
   * @returns {Promise<{email: string, x25519Fingerprint: string, ed25519Fingerprint: string}>}
   */
  async getFingerprint(email) {
    await ready();
    this._requireSession();
    const normalizedEmail = normalizeEmail(email);
    const keys = await this.transport.getUserKeys(normalizedEmail);
    return {
      email: normalizedEmail,
      x25519Fingerprint: sharing.publicKeyFingerprint(fromBase64(keys.x25519PublicKey)),
      ed25519Fingerprint: sharing.publicKeyFingerprint(fromBase64(keys.ed25519PublicKey)),
    };
  }
}

/**
 * D28: chặn nội dung quá lớn NGAY Ở CLIENT, trước khi mã hóa — vừa báo lỗi rõ
 * ràng cho người dùng, vừa không tốn công mã hóa thứ server sẽ từ chối.
 */
function assertPlaintextSize(content) {
  const bytes = sodium.from_string(content).length;
  if (bytes > LIMITS.MAX_NOTE_PLAINTEXT_BYTES) {
    throw new Error(
      `Nội dung note ${bytes} byte, vượt giới hạn ${LIMITS.MAX_NOTE_PLAINTEXT_BYTES} byte.`,
    );
  }
}
