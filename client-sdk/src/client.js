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
import { ApiError } from './apiError.js';
import { assertAcceptablePassword } from './passwordPolicy.js';
import { createMemoryVersionStore } from './versionStore.js';

// client-sdk KHÔNG tự import libsodium-wrappers-sumo: mọi thao tác mật mã đi
// qua @secure-notes/crypto để chỉ một chỗ duy nhất trong repo chạm vào thư viện.
let sodium;

async function ready() {
  sodium = await getSodium();
}

/**
 * Chạy một thao tác MỞ dữ liệu từ server (giải mã, gỡ bọc khóa, xác minh chữ ký). Thất bại ở đây
 * nghĩa là dữ liệu đã bị sửa, bị tráo hoặc không khớp ngữ cảnh — đổi thành INTEGRITY_ERROR để giao
 * diện xử lý theo `code`, và giữ thông điệp gốc để gỡ lỗi. TypeError (lỗi lập trình, ví dụ thiếu
 * ngữ cảnh AD) và ApiError có sẵn thì để nguyên.
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function openOrReject(operation) {
  try {
    return await operation();
  } catch (err) {
    if (err instanceof ApiError || err instanceof TypeError) throw err;
    throw new ApiError(
      'INTEGRITY_ERROR',
      'Không mở được dữ liệu từ máy chủ: dữ liệu đã bị sửa, bị tráo hoặc không khớp. ' +
        `Ứng dụng từ chối hiển thị để bảo vệ bạn. (${err.message})`,
    );
  }
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
   * @param {object} [options]
   * @param {import('./versionStore.js').VersionStore} [options.versionStore] nơi nhớ version
   *   cao nhất đã thấy của từng note (D20). Mặc định chỉ nhớ trong bộ nhớ; giao diện nên
   *   truyền createLocalStorageVersionStore() để còn nhớ sau khi tải lại trang.
   */
  constructor(transport, { versionStore = createMemoryVersionStore() } = {}) {
    if (!transport) {
      throw new Error('SecureNoteClient cần một transport (memoryTransport hoặc fetchTransport)');
    }
    this.transport = transport;
    this._versions = versionStore;
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
    // Trước mọi thứ khác: mật khẩu yếu thì không chạy Argon2id, không gửi gì lên server.
    assertAcceptablePassword(password);
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

    // authKey đã đúng (server chấp nhận) mà vẫn không mở được khóa bọc thì khóa bọc đã bị sửa.
    const vaultKey = await openOrReject(() =>
      vault.unwrapVaultKey(account.wrappedVaultKey, masterKey),
    );
    const x25519PrivateKey = await openOrReject(() =>
      sharing.unwrapPrivateKey(account.wrappedX25519PrivateKey, masterKey),
    );
    const ed25519PrivateKey = await openOrReject(() =>
      sharing.unwrapPrivateKey(account.wrappedEd25519PrivateKey, masterKey),
    );

    // Khóa công khai của chính mình SUY RA từ khóa riêng, không tin bản server gửi. Server gửi bản
    // khác thì nó đang phát khóa giả cho người khác dùng để chia sẻ với mình — dừng lại ngay.
    const x25519PublicKey = sodium.crypto_scalarmult_base(x25519PrivateKey);
    const ed25519PublicKey = sodium.crypto_sign_ed25519_sk_to_pk(ed25519PrivateKey);
    if (
      !sodium.memcmp(x25519PublicKey, fromBase64(account.x25519PublicKey)) ||
      !sodium.memcmp(ed25519PublicKey, fromBase64(account.ed25519PublicKey))
    ) {
      sodium.memzero(masterKey);
      sodium.memzero(vaultKey);
      sodium.memzero(x25519PrivateKey);
      sodium.memzero(ed25519PrivateKey);
      throw new ApiError(
        'INTEGRITY_ERROR',
        'Khóa công khai máy chủ lưu cho tài khoản này không khớp với khóa riêng của bạn.',
      );
    }

    this._session = {
      email: account.email,
      masterKey,
      vaultKey,
      x25519PrivateKey,
      x25519PublicKey,
      ed25519PrivateKey,
      ed25519PublicKey,
    };

    return { email: account.email };
  }

  /**
   * Đăng xuất: hủy phiên ở server (D26) rồi xóa khóa khỏi bộ nhớ bằng
   * sodium.memzero, thay vì chỉ gán null và chờ garbage collector — giảm thời
   * gian khóa nhạy cảm còn nằm trong RAM.
   *
   * Khóa được xóa kể cả khi gọi server thất bại (mất mạng), vì xóa khóa cục bộ
   * là việc quan trọng hơn. Server trả UNAUTHENTICATED (phiên đã hết hạn, hoặc đã
   * bị hủy vì đổi mật khẩu ở thiết bị khác) thì mục tiêu đã đạt: không báo lỗi.
   * Lỗi khác (mất mạng...) vẫn được ném ra sau khi đã xóa khóa, để giao diện cảnh
   * báo rằng phiên ở server có thể vẫn còn sống.
   */
  async logout() {
    try {
      await this.transport.logout();
    } catch (err) {
      if (err?.code !== 'UNAUTHENTICATED') throw err;
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
    const session = this._requireSession();
    // Chỉ kiểm tra mật khẩu MỚI. Mật khẩu cũ có thể yếu (đặt trước khi có chính sách này); chặn nó thì
    // người dùng bị kẹt, không đổi được sang mật khẩu mạnh hơn.
    assertAcceptablePassword(newPassword);
    await ready();

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
    assertPlaintextSize('Nội dung note', content, LIMITS.MAX_NOTE_PLAINTEXT_BYTES);
    assertPlaintextSize('Tiêu đề note', title, LIMITS.MAX_NOTE_TITLE_BYTES);

    // D17: id do client sinh vì nó sẽ nằm trong Associated Data của ciphertext.
    const id = globalThis.crypto.randomUUID();
    const noteKey = vault.generateVaultKey();

    const version = NOTE_VERSION_START;
    const payload = {
      id,
      version,
      encryptedTitle: await note.encryptNote(title, noteKey, {
        noteId: id,
        version,
        field: 'title',
      }),
      encryptedContent: await note.encryptNote(content, noteKey, {
        noteId: id,
        version,
        field: 'content',
      }),
      wrappedNoteKey: await vault.wrapVaultKey(noteKey, session.vaultKey),
    };
    sodium.memzero(noteKey);

    const result = await this.transport.createNote(payload);
    this._seeVersion(id, result.version);
    return result;
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
        this._seeVersion(item.id, item.version);
        const noteKey = await openOrReject(() =>
          vault.unwrapVaultKey(item.wrappedNoteKey, session.vaultKey),
        );
        try {
          const title = await openOrReject(() =>
            note.decryptNote(item.encryptedTitle, noteKey, {
              noteId: item.id,
              version: item.version,
              field: 'title',
            }),
          );
          return { id: item.id, version: item.version, title, updatedAt: item.updatedAt };
        } finally {
          sodium.memzero(noteKey);
        }
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
    const record = await this._fetchNote(noteId);

    let noteKey;
    let sharedBy = null;
    if (record.wrappedNoteKey) {
      noteKey = await this._ownedNoteKey(record, session);
    } else if (record.share) {
      const senderKeys = await this.transport.getUserKeys(record.share.senderEmail);
      noteKey = await openOrReject(() =>
        sharing.unwrapNoteKeyFromSender(
          record.share.sharePackage,
          session.x25519PrivateKey,
          fromBase64(senderKeys.ed25519PublicKey),
          noteId,
        ),
      );
      sharedBy = record.share.senderEmail;
    } else {
      // Server đúng đắn luôn trả một trong hai. Thiếu cả hai là dấu hiệu server
      // lỗi hoặc bị can thiệp — từ chối thay vì đoán.
      throw new ApiError(
        'INTEGRITY_ERROR',
        'Server không trả về khóa để mở note này, từ chối xử lý tiếp.',
      );
    }

    // Ngữ cảnh lấy từ noteId MÀ CLIENT HỎI, không phải id server khai (D19).
    let title;
    let content;
    try {
      title = await openOrReject(() =>
        note.decryptNote(record.encryptedTitle, noteKey, {
          noteId,
          version: record.version,
          field: 'title',
        }),
      );
      content = await openOrReject(() =>
        note.decryptNote(record.encryptedContent, noteKey, {
          noteId,
          version: record.version,
          field: 'content',
        }),
      );
    } finally {
      sodium.memzero(noteKey);
    }

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
   * `verifiedFingerprint` là kết quả `getFingerprint()` mà người dùng ĐÃ đối chiếu. Khi có, khóa
   * dùng để chia sẻ phải đúng là khóa đó: nếu không, máy chủ có thể đưa khóa thật lúc hiển thị mã
   * rồi tráo khóa giả lúc chia sẻ, và việc đối chiếu thành vô nghĩa (D75). Giao diện luôn nên truyền.
   *
   * @param {string} noteId
   * @param {string} recipientEmail
   * @param {{verifiedFingerprint?: {email: string, x25519Fingerprint: string}}} [options]
   * @returns {Promise<{id: string}>}
   */
  async shareNote(noteId, recipientEmail, { verifiedFingerprint } = {}) {
    await ready();
    const session = this._requireSession();
    const normalizedRecipient = normalizeEmail(recipientEmail);

    const recipientKeys = await this.transport.getUserKeys(normalizedRecipient);
    const recipientPublicKey = fromBase64(recipientKeys.x25519PublicKey);
    if (
      verifiedFingerprint &&
      (verifiedFingerprint.email !== normalizedRecipient ||
        sharing.publicKeyFingerprint(recipientPublicKey) !== verifiedFingerprint.x25519Fingerprint)
    ) {
      throw new ApiError(
        'INTEGRITY_ERROR',
        'Khóa công khai của người nhận đã thay đổi so với mã bạn vừa đối chiếu, từ chối chia sẻ.',
      );
    }

    const record = await this._fetchNote(noteId);
    const noteKey = await this._ownedNoteKey(record, session);
    let sharePackage;
    try {
      sharePackage = await sharing.wrapNoteKeyForRecipient(
        noteKey,
        recipientPublicKey,
        session.ed25519PrivateKey,
        noteId,
      );
    } finally {
      sodium.memzero(noteKey);
    }

    return this.transport.shareNote(noteId, {
      recipientEmail: normalizedRecipient,
      sharePackage,
    });
  }

  /**
   * Sửa tiêu đề và nội dung một note của mình. Khóa note giữ nguyên, nên người
   * đang được chia sẻ đọc được bản mới mà không cần gói chia sẻ mới.
   *
   * `version` là version của bản mà người dùng ĐANG SỬA (lấy từ readNote), không
   * phải version mới nhất trên server. Nếu trong lúc sửa, thiết bị khác đã lưu một
   * bản mới hơn, thao tác này thất bại với VERSION_CONFLICT thay vì âm thầm ghi đè
   * lên thay đổi của thiết bị kia (D18). Giao diện nên báo người dùng tải lại.
   *
   * @param {string} noteId
   * @param {{title: string, content: string, version: number}} input
   * @returns {Promise<{id: string, version: number, updatedAt: string}>}
   */
  async updateNote(noteId, { title, content, version }) {
    await ready();
    const session = this._requireSession();
    if (!Number.isInteger(version) || version < NOTE_VERSION_START) {
      throw new TypeError('version phải là version của bản đang sửa (số nguyên >= 1).');
    }
    assertPlaintextSize('Nội dung note', content, LIMITS.MAX_NOTE_PLAINTEXT_BYTES);
    assertPlaintextSize('Tiêu đề note', title, LIMITS.MAX_NOTE_TITLE_BYTES);

    const record = await this._fetchNote(noteId);
    // Server sẽ từ chối y như vậy; kiểm tra sớm để khỏi mã hóa và gửi đi vô ích.
    if (record.version !== version) {
      throw new ApiError('VERSION_CONFLICT', 'Note đã bị thay đổi ở nơi khác, hãy tải lại.');
    }
    const noteKey = await this._ownedNoteKey(record, session);

    const next = version + 1;
    const payload = {
      version: next,
      encryptedTitle: await note.encryptNote(title, noteKey, {
        noteId,
        version: next,
        field: 'title',
      }),
      encryptedContent: await note.encryptNote(content, noteKey, {
        noteId,
        version: next,
        field: 'content',
      }),
    };
    sodium.memzero(noteKey);

    const result = await this.transport.updateNote(noteId, payload);
    this._seeVersion(noteId, result.version);
    return result;
  }

  /**
   * Xóa một note của mình. Mọi gói chia sẻ của note cũng bị xóa theo.
   * @param {string} noteId
   * @returns {Promise<void>}
   */
  async deleteNote(noteId) {
    this._requireSession();
    await this.transport.deleteNote(noteId);
  }

  /**
   * Note của mình đang được chia sẻ cho những ai.
   * @param {string} noteId
   * @returns {Promise<Array<{id: string, recipientEmail: string, createdAt: string}>>}
   */
  async listNoteShares(noteId) {
    this._requireSession();
    return this.transport.listNoteShares(noteId);
  }

  /**
   * Gỡ một gói chia sẻ. CHỈ chặn lần đọc sau qua server — KHÔNG phải thu hồi mật
   * mã: người nhận đã từng mở note thì có thể đã giữ lại khóa note, và vẫn giải mã
   * được nếu có được ciphertext (ví dụ từ bản sao lưu, hoặc từ một server gian lận).
   * Muốn thu hồi thật sự, dùng revokeAccess() (D53).
   *
   * @param {string} shareId id lấy từ listNoteShares()
   * @returns {Promise<void>}
   */
  async unshareNote(shareId) {
    this._requireSession();
    await this.transport.deleteShare(shareId);
  }

  /**
   * Thu hồi quyền truy cập bằng cách XOAY KHÓA note (D24, D50):
   *  1. sinh khóa note mới và mã hóa lại tiêu đề, nội dung;
   *  2. tạo gói chia sẻ mới (chứa khóa mới) cho những người còn giữ quyền;
   *  3. gửi tất cả trong một yêu cầu, server áp dụng trong một transaction.
   *
   * Người bị thu hồi mất gói chia sẻ, và khóa cũ họ có thể đã giữ lại không mở được
   * nội dung mới. Họ vẫn giữ được những gì ĐÃ đọc trước đó — không kỹ thuật nào lấy
   * lại được thứ đã lộ.
   *
   * Danh sách rỗng nghĩa là chỉ xoay khóa, giữ nguyên mọi người (ví dụ khi nghi ngờ
   * khóa cũ bị lộ).
   *
   * Giới hạn: danh sách người nhận được đọc ngay trước khi xoay. Nếu đúng lúc đó một
   * thiết bị khác của chính bạn vừa chia sẻ note cho người mới, người đó cũng bị gỡ.
   *
   * @param {string} noteId
   * @param {string[]} recipientEmails những người bị thu hồi quyền
   * @returns {Promise<{id: string, version: number, updatedAt: string, keptRecipients: string[]}>}
   */
  async revokeAccess(noteId, recipientEmails) {
    await ready();
    const session = this._requireSession();

    const record = await this._fetchNote(noteId);
    const oldKey = await this._ownedNoteKey(record, session);
    let title;
    let content;
    try {
      title = await openOrReject(() =>
        note.decryptNote(record.encryptedTitle, oldKey, {
          noteId,
          version: record.version,
          field: 'title',
        }),
      );
      content = await openOrReject(() =>
        note.decryptNote(record.encryptedContent, oldKey, {
          noteId,
          version: record.version,
          field: 'content',
        }),
      );
    } finally {
      sodium.memzero(oldKey);
    }

    const current = (await this.transport.listNoteShares(noteId)).map((s) => s.recipientEmail);
    const revoked = new Set(recipientEmails.map(normalizeEmail));
    const unknown = [...revoked].filter((email) => !current.includes(email));
    if (unknown.length > 0) {
      // Nhiều khả năng là gõ nhầm email; xoay khóa rồi mới phát hiện thì người dùng
      // lại tưởng đã thu hồi được quyền của ai đó.
      throw new Error(`Note này không được chia sẻ cho: ${unknown.join(', ')}.`);
    }
    const kept = current.filter((email) => !revoked.has(email));

    const newKey = vault.generateVaultKey();
    try {
      const shares = [];
      for (const recipientEmail of kept) {
        const keys = await this.transport.getUserKeys(recipientEmail);
        shares.push({
          recipientEmail,
          sharePackage: await sharing.wrapNoteKeyForRecipient(
            newKey,
            fromBase64(keys.x25519PublicKey),
            session.ed25519PrivateKey,
            noteId,
          ),
        });
      }

      const next = record.version + 1;
      const result = await this.transport.rotateNote(noteId, {
        version: next,
        encryptedTitle: await note.encryptNote(title, newKey, {
          noteId,
          version: next,
          field: 'title',
        }),
        encryptedContent: await note.encryptNote(content, newKey, {
          noteId,
          version: next,
          field: 'content',
        }),
        wrappedNoteKey: await vault.wrapVaultKey(newKey, session.vaultKey),
        shares,
      });
      this._seeVersion(noteId, result.version);
      return { ...result, keptRecipients: kept };
    } finally {
      sodium.memzero(newKey);
    }
  }

  /**
   * Lấy một note từ server và kiểm tra hai điều trước khi dùng:
   *  - server trả đúng note được hỏi (id khớp);
   *  - không phải một bản CŨ hơn bản client đã từng thấy (D20).
   * Mọi thao tác đọc note đều đi qua đây, kể cả khi chỉ để lấy khóa (chia sẻ, sửa,
   * thu hồi): một bản cũ có thể mang khóa note cũ trước lần xoay khóa gần nhất.
   */
  async _fetchNote(noteId) {
    const record = await this.transport.getNote(noteId);
    if (record.id !== noteId) {
      throw new ApiError(
        'INTEGRITY_ERROR',
        'Server trả về note khác với note được hỏi, từ chối xử lý tiếp.',
      );
    }
    this._seeVersion(noteId, record.version);
    return record;
  }

  /**
   * Ghi nhận một version vừa thấy của note. Nếu thấp hơn version cao nhất từng thấy thì
   * server đang trả bản cũ (rollback): ném ROLLBACK_DETECTED, không dùng dữ liệu đó.
   * Giới hạn: lần đầu đọc note trên một thiết bị mới thì chưa có gì để so.
   */
  _seeVersion(noteId, version) {
    const scope = this._session.email;
    const highest = this._versions.get(scope, noteId);
    if (highest !== undefined && version < highest) {
      throw new ApiError(
        'ROLLBACK_DETECTED',
        `Server trả về phiên bản ${version} của note, cũ hơn phiên bản ${highest} bạn đã thấy. ` +
          'Có thể server bị lỗi hoặc bị can thiệp.',
      );
    }
    if (highest === undefined || version > highest) this._versions.set(scope, noteId, version);
  }

  /**
   * Mở khóa note của một note mà người gọi LÀ CHỦ. Note được chia sẻ (chỉ có
   * `share`, không có `wrappedNoteKey`) thì không sửa, xóa hay chia sẻ tiếp được.
   */
  async _ownedNoteKey(record, session) {
    if (!record.wrappedNoteKey) {
      throw new Error('Bạn không phải chủ note này.');
    }
    return openOrReject(() => vault.unwrapVaultKey(record.wrappedNoteKey, session.vaultKey));
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
   * Mã xác minh (fingerprint) khóa công khai của CHÍNH MÌNH, tính từ khóa trong bộ nhớ (đã suy ra
   * từ khóa riêng lúc đăng nhập) — không hỏi máy chủ. Nếu hỏi máy chủ, một máy chủ đã tráo khóa của
   * mình khi đưa cho người khác cũng có thể đưa cho mình đúng khóa giả đó, và hai bên sẽ thấy mã
   * "khớp nhau". Người nhận đọc mã này cho người gửi đối chiếu với getFingerprint().
   *
   * @returns {{email: string, x25519Fingerprint: string, ed25519Fingerprint: string}}
   */
  myFingerprint() {
    const session = this._requireSession();
    return {
      email: session.email,
      x25519Fingerprint: sharing.publicKeyFingerprint(session.x25519PublicKey),
      ed25519Fingerprint: sharing.publicKeyFingerprint(session.ed25519PublicKey),
    };
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
 * Server cũng chặn ciphertext vượt trần tương ứng (SealedBounded trong shared/).
 * @param {string} label tên trường, dùng trong thông báo lỗi
 * @param {string} text
 * @param {number} maxBytes
 */
function assertPlaintextSize(label, text, maxBytes) {
  const bytes = sodium.from_string(text).length;
  if (bytes > maxBytes) {
    throw new ApiError(
      'PAYLOAD_TOO_LARGE',
      `${label} ${bytes} byte, vượt giới hạn ${maxBytes} byte.`,
    );
  }
}
