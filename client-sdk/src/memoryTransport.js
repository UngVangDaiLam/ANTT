/**
 * memoryTransport.js
 * ------------------
 * "Server giả" chạy trong bộ nhớ, để phát triển và test client SDK mà không cần
 * backend thật. KHÔNG PHẢI backend thật: không lưu bền vững, không rate limit,
 * không TLS, và giữ authKey nguyên dạng thay vì băm.
 *
 * Nhưng nó cố tình cư xử giống server thật ở đúng những điểm client dễ làm sai:
 *  - Kiểm tra payload gửi lên VÀ dữ liệu trả về bằng CHÍNH schema trong
 *    `@secure-notes/shared` mà server dùng. Đặt tên trường sai là test đỏ ngay,
 *    không phải đợi tới lúc nối vào server thật mới phát hiện.
 *  - Lấy danh tính từ phiên đăng nhập, không tin email trong body (D16).
 *  - Note không thuộc về người gọi và cũng không được chia sẻ cho họ thì trả
 *    NOT_FOUND, không trả FORBIDDEN (D30).
 *  - Đăng ký KHÔNG tạo phiên; phải gọi login sau đó (D36).
 *  - Email chưa đăng ký vẫn nhận được salt (giả) khi tra cứu (D15).
 *
 * Một "server" (createMemoryServer) giữ dữ liệu chung; mỗi connect() là một
 * trình duyệt riêng với phiên đăng nhập riêng. Nhờ vậy test dựng được nhiều
 * người dùng cùng lúc trên cùng một server, đúng như thực tế.
 */

import { Value } from '@sinclair/typebox/value';
import {
  AUTH_ATTEMPT_KINDS,
  ChangePasswordRequest,
  DeleteAccountRequest,
  KDF_DEFAULTS,
  LIMITS,
  LoginHistoryResponse,
  LoginRequest,
  NoteCreateRequest,
  NoteListResponse,
  NoteResponse,
  NoteShareListResponse,
  NoteUpdateRequest,
  NoteWriteResponse,
  RotateRequest,
  RegisterRequest,
  RevokeSessionsRequest,
  RevokeSessionsResponse,
  SaltResponse,
  SelfAccountResponse,
  SessionListResponse,
  ShareCreateRequest,
  ShareCreatedResponse,
  ShareListResponse,
  UserKeysResponse,
  normalizeEmail,
} from '@secure-notes/shared';
import { assertSchema } from './assertSchema.js';
import { ApiError } from './apiError.js';

/**
 * Kiểm tra payload gửi lên giống hệt cách server làm: schema có
 * additionalProperties: false nên thừa trường là bị từ chối, không âm thầm xóa (D31).
 */
function checkRequest(schema, payload, label) {
  if (Value.Check(schema, payload)) return payload;
  const firstError = Value.Errors(schema, payload).First();
  const detail = firstError ? `${firstError.path}: ${firstError.message}` : 'không rõ chi tiết';
  throw new ApiError('VALIDATION_ERROR', `Payload sai hợp đồng API (${label}) - ${detail}.`);
}

/**
 * Salt giả, cố định theo email, cho email chưa đăng ký (D15). Server thật dùng
 * HMAC với bí mật của server (`server/src/lib/fake-salt.js`); bản mô phỏng chỉ
 * cần đúng 16 byte và luôn giống nhau với cùng một email.
 */
function fakeSaltFor(email) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    let h = 0x811c9dc5;
    for (const ch of `fake-salt:${email}:${i}`) {
      h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    }
    bytes[i] = h & 0xff;
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Một server giả với kho dữ liệu dùng chung.
 * @returns {{connect: () => import('./transportType.js').Transport}}
 */
export function createMemoryServer() {
  const users = new Map(); // email đã chuẩn hóa -> hồ sơ (chỉ chứa dữ liệu đã mã hóa sẵn)
  const notes = new Map(); // id -> hồ sơ note (chỉ chứa ciphertext)
  const shares = new Map(); // id -> gói chia sẻ
  const sessions = new Map(); // id -> { id, email, createdAt, lastSeenAt, expiresAt }
  const loginHistory = []; // { id, email, success, kind, createdAt }, chỉ email ĐÃ đăng ký

  function recordAttempt(email, success, kind) {
    loginHistory.push({
      id: crypto.randomUUID(),
      email,
      success,
      kind,
      createdAt: new Date().toISOString(),
    });
  }

  /** Id phiên giả: 64 ký tự hex như SHA-256 của token ở server thật. */
  function newSessionId() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Một kết nối = một trình duyệt, có phiên đăng nhập riêng (thay cho cookie). */
  function connect() {
    let sessionId = null;

    /**
     * Như server thật: phiên có thể bị hủy từ nơi khác (đăng xuất từ xa, đổi mật khẩu), nên mỗi lần
     * gọi đều tra lại trong kho phiên chung chứ không tin biến cục bộ.
     */
    function requireSession() {
      const session = sessions.get(sessionId);
      if (!session) {
        sessionId = null;
        throw new ApiError('UNAUTHENTICATED', 'Chưa đăng nhập.');
      }
      session.lastSeenAt = new Date().toISOString();
      return session.email;
    }

    const notFound = () => new ApiError('NOT_FOUND', 'Không tìm thấy.');
    const versionConflict = () =>
      new ApiError('VERSION_CONFLICT', 'Note đã bị thay đổi ở nơi khác, hãy tải lại.');
    const writeResult = (record) => ({
      id: record.id,
      version: record.version,
      updatedAt: record.updatedAt,
    });

    return {
      async register(payload) {
        checkRequest(RegisterRequest, payload, 'POST /api/register');
        const email = normalizeEmail(payload.email);
        if (users.has(email)) throw new ApiError('EMAIL_TAKEN', 'Email này đã được đăng ký.');
        // GHI CHÚ CHO BACKEND: server THẬT lưu SHA-256(authKey) và so sánh bằng
        // timingSafeEqual (D14), không giữ authKey gốc như bản mô phỏng này.
        users.set(email, { ...payload, email });
        // D36: không tạo phiên ở đây.
      },

      async getSalt(email) {
        const normalized = normalizeEmail(email);
        const user = users.get(normalized);
        const body = user
          ? { salt: user.salt, kdfParams: user.kdfParams }
          : { salt: fakeSaltFor(normalized), kdfParams: { ...KDF_DEFAULTS } };
        return assertSchema(SaltResponse, body, 'POST /api/users/salt');
      },

      async login(payload) {
        checkRequest(LoginRequest, payload, 'POST /api/login');
        const user = users.get(normalizeEmail(payload.email));
        const success = Boolean(user) && user.authKey === payload.authKey;
        if (user) recordAttempt(user.email, success, AUTH_ATTEMPT_KINDS.LOGIN);
        // Không phân biệt "email không tồn tại" với "sai mật khẩu".
        if (!success) {
          throw new ApiError('INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
        }
        // Đăng nhập luôn cấp phiên mới và bỏ phiên cũ của kết nối này (D44).
        sessions.delete(sessionId);
        const now = new Date();
        sessionId = newSessionId();
        sessions.set(sessionId, {
          id: sessionId,
          email: user.email,
          createdAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        });
        return assertSchema(
          SelfAccountResponse,
          {
            email: user.email,
            wrappedVaultKey: user.wrappedVaultKey,
            x25519PublicKey: user.x25519PublicKey,
            ed25519PublicKey: user.ed25519PublicKey,
            wrappedX25519PrivateKey: user.wrappedX25519PrivateKey,
            wrappedEd25519PrivateKey: user.wrappedEd25519PrivateKey,
          },
          'POST /api/login',
        );
      },

      async logout() {
        sessions.delete(sessionId);
        sessionId = null;
      },

      async changePassword(payload) {
        const email = requireSession();
        checkRequest(ChangePasswordRequest, payload, 'POST /api/change-password');
        const user = users.get(email);
        recordAttempt(
          email,
          user.authKey === payload.oldAuthKey,
          AUTH_ATTEMPT_KINDS.CHANGE_PASSWORD,
        );
        if (user.authKey !== payload.oldAuthKey) {
          throw new ApiError('INVALID_CREDENTIALS', 'Mật khẩu cũ không đúng.');
        }
        user.salt = payload.salt;
        user.kdfParams = payload.kdfParams;
        user.authKey = payload.authKey;
        user.wrappedVaultKey = payload.wrappedVaultKey;
        user.wrappedX25519PrivateKey = payload.wrappedX25519PrivateKey;
        user.wrappedEd25519PrivateKey = payload.wrappedEd25519PrivateKey;
        // D25: giữ phiên hiện tại, hủy mọi phiên khác của người này.
        for (const [id, session] of sessions) {
          if (session.email === email && id !== sessionId) sessions.delete(id);
        }
      },

      async deleteAccount(payload) {
        const email = requireSession();
        checkRequest(DeleteAccountRequest, payload, 'POST /api/account/delete');
        if (users.get(email).authKey !== payload.authKey) {
          recordAttempt(email, false, AUTH_ATTEMPT_KINDS.DELETE_ACCOUNT);
          throw new ApiError('INVALID_CREDENTIALS', 'Mật khẩu không đúng.');
        }
        // Như onDelete: Cascade ở server thật: phiên, note (kèm lượt chia sẻ của note), lượt chia sẻ
        // gửi đi và nhận về; lịch sử đăng nhập cũng xóa theo.
        users.delete(email);
        for (const [id, session] of sessions) if (session.email === email) sessions.delete(id);
        for (const [id, note] of notes) if (note.ownerEmail === email) notes.delete(id);
        for (const [id, share] of shares) {
          const orphan = !notes.has(share.noteId);
          if (orphan || share.senderEmail === email || share.recipientEmail === email) {
            shares.delete(id);
          }
        }
        for (let i = loginHistory.length - 1; i >= 0; i--) {
          if (loginHistory[i].email === email) loginHistory.splice(i, 1);
        }
        sessionId = null;
      },

      async listSessions() {
        const email = requireSession();
        const body = [...sessions.values()]
          .filter((session) => session.email === email)
          .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
          .map((session) => ({
            id: session.id,
            current: session.id === sessionId,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            expiresAt: session.expiresAt,
            ip: null,
            userAgent: null,
          }));
        return assertSchema(SessionListResponse, body, 'GET /api/sessions');
      },

      async revokeSessions(payload) {
        const email = requireSession();
        checkRequest(RevokeSessionsRequest, payload, 'POST /api/sessions/revoke');
        if (payload.sessionId === sessionId) {
          throw new ApiError('VALIDATION_ERROR', 'Dùng đăng xuất để kết thúc phiên hiện tại.');
        }
        const keyMatches = users.get(email).authKey === payload.authKey;
        recordAttempt(email, keyMatches, AUTH_ATTEMPT_KINDS.REVOKE_SESSIONS);
        if (!keyMatches) {
          throw new ApiError('INVALID_CREDENTIALS', 'Mật khẩu không đúng.');
        }
        let revoked = 0;
        for (const [id, session] of sessions) {
          if (session.email !== email || id === sessionId) continue;
          if (payload.sessionId !== undefined && id !== payload.sessionId) continue;
          sessions.delete(id);
          revoked += 1;
        }
        if (payload.sessionId !== undefined && revoked === 0) throw notFound();
        return assertSchema(RevokeSessionsResponse, { revoked }, 'POST /api/sessions/revoke');
      },

      async getLoginHistory() {
        const email = requireSession();
        const body = loginHistory
          .filter((entry) => entry.email === email)
          .reverse()
          .slice(0, LIMITS.LOGIN_HISTORY_LIMIT)
          .map(({ id, success, kind, createdAt }) => ({
            id,
            success,
            kind,
            createdAt,
            ip: null,
            userAgent: null,
          }));
        return assertSchema(LoginHistoryResponse, body, 'GET /api/login-history');
      },

      async getUserKeys(email) {
        requireSession();
        const user = users.get(normalizeEmail(email));
        if (!user) throw new ApiError('NOT_FOUND', 'Không tìm thấy người dùng này.');
        return assertSchema(
          UserKeysResponse,
          { x25519PublicKey: user.x25519PublicKey, ed25519PublicKey: user.ed25519PublicKey },
          'POST /api/users/keys',
        );
      },

      async createNote(payload) {
        const email = requireSession();
        checkRequest(NoteCreateRequest, payload, 'POST /api/notes');
        // D17: id do client sinh, server từ chối id đã tồn tại.
        if (notes.has(payload.id)) {
          throw new ApiError('NOTE_ID_TAKEN', 'Note id này đã tồn tại.');
        }
        const now = new Date().toISOString();
        notes.set(payload.id, { ...payload, ownerEmail: email, createdAt: now, updatedAt: now });
        return assertSchema(
          NoteWriteResponse,
          { id: payload.id, version: payload.version, updatedAt: now },
          'POST /api/notes',
        );
      },

      async listNotes() {
        const email = requireSession();
        const body = [...notes.values()]
          .filter((n) => n.ownerEmail === email)
          .map((n) => ({
            id: n.id,
            version: n.version,
            encryptedTitle: n.encryptedTitle,
            wrappedNoteKey: n.wrappedNoteKey,
            updatedAt: n.updatedAt,
          }));
        return assertSchema(NoteListResponse, body, 'GET /api/notes');
      },

      async getNote(noteId) {
        const email = requireSession();
        const record = notes.get(noteId);
        // D30: không phân biệt "không tồn tại" với "không phải của bạn".
        const notFound = () => new ApiError('NOT_FOUND', 'Không tìm thấy.');
        if (!record) throw notFound();

        const common = {
          id: record.id,
          version: record.version,
          encryptedTitle: record.encryptedTitle,
          encryptedContent: record.encryptedContent,
          updatedAt: record.updatedAt,
        };

        let body;
        if (record.ownerEmail === email) {
          body = { ...common, wrappedNoteKey: record.wrappedNoteKey };
        } else {
          // D22: người được chia sẻ đọc chính note gốc, kèm gói chia sẻ của riêng họ.
          const share = [...shares.values()].find(
            (s) => s.noteId === noteId && s.recipientEmail === email,
          );
          if (!share) throw notFound();
          body = {
            ...common,
            share: { senderEmail: share.senderEmail, sharePackage: share.sharePackage },
          };
        }
        return assertSchema(NoteResponse, body, 'GET /api/notes/:id');
      },

      async shareNote(noteId, payload) {
        const email = requireSession();
        checkRequest(ShareCreateRequest, payload, 'POST /api/notes/:id/shares');
        const record = notes.get(noteId);
        // Không phải chủ note thì cư xử y như note không tồn tại (D30).
        if (!record || record.ownerEmail !== email) {
          throw new ApiError('NOT_FOUND', 'Không tìm thấy.');
        }
        const recipientEmail = normalizeEmail(payload.recipientEmail);
        if (!users.has(recipientEmail)) {
          throw new ApiError('NOT_FOUND', 'Không tìm thấy người nhận.');
        }
        if (recipientEmail === email) {
          throw new ApiError('VALIDATION_ERROR', 'Không thể tự chia sẻ cho chính mình.');
        }

        // Prisma có @@unique([noteId, recipientId]): chia sẻ lại cho cùng một người
        // là THAY gói cũ (cần sau khi xoay khóa note - D24), không tạo bản ghi mới.
        const existing = [...shares.values()].find(
          (s) => s.noteId === noteId && s.recipientEmail === recipientEmail,
        );
        const id = existing ? existing.id : globalThis.crypto.randomUUID();
        shares.set(id, {
          id,
          noteId,
          senderEmail: email,
          recipientEmail,
          sharePackage: payload.sharePackage,
          createdAt: existing ? existing.createdAt : new Date().toISOString(),
        });
        return assertSchema(ShareCreatedResponse, { id }, 'POST /api/notes/:id/shares');
      },

      async updateNote(noteId, payload) {
        const email = requireSession();
        checkRequest(NoteUpdateRequest, payload, 'PUT /api/notes/:id');
        const record = notes.get(noteId);
        // Người được chia sẻ cũng không sửa được: chỉ chủ note (D30: trả NOT_FOUND).
        if (!record || record.ownerEmail !== email) throw notFound();
        // D18: chỉ nhận đúng version hiện tại + 1.
        if (payload.version !== record.version + 1) throw versionConflict();
        record.version = payload.version;
        record.encryptedTitle = payload.encryptedTitle;
        record.encryptedContent = payload.encryptedContent;
        record.updatedAt = new Date().toISOString();
        return assertSchema(NoteWriteResponse, writeResult(record), 'PUT /api/notes/:id');
      },

      async deleteNote(noteId) {
        const email = requireSession();
        const record = notes.get(noteId);
        if (!record || record.ownerEmail !== email) throw notFound();
        notes.delete(noteId);
        // Như onDelete: Cascade của Prisma: gói chia sẻ của note bị xóa theo.
        for (const [id, share] of shares) if (share.noteId === noteId) shares.delete(id);
      },

      async rotateNote(noteId, payload) {
        const email = requireSession();
        checkRequest(RotateRequest, payload, 'POST /api/notes/:id/rotate');
        const record = notes.get(noteId);
        if (!record || record.ownerEmail !== email) throw notFound();
        if (payload.version !== record.version + 1) throw versionConflict();

        // Kiểm tra HẾT trước khi đổi bất cứ thứ gì: server thật chạy trong một transaction,
        // lỗi ở bất kỳ bước nào thì không có gì thay đổi.
        const keep = payload.shares.map((entry) => ({
          recipientEmail: normalizeEmail(entry.recipientEmail),
          sharePackage: entry.sharePackage,
        }));
        const emails = keep.map((entry) => entry.recipientEmail);
        if (new Set(emails).size !== emails.length) {
          throw new ApiError('VALIDATION_ERROR', 'Danh sách người nhận có email bị lặp.');
        }
        if (emails.some((recipient) => !users.has(recipient))) {
          throw new ApiError('NOT_FOUND', 'Không tìm thấy một trong những người nhận.');
        }
        if (emails.includes(email)) {
          throw new ApiError('VALIDATION_ERROR', 'Không thể chia sẻ cho chính mình.');
        }

        record.version = payload.version;
        record.encryptedTitle = payload.encryptedTitle;
        record.encryptedContent = payload.encryptedContent;
        record.wrappedNoteKey = payload.wrappedNoteKey;
        record.updatedAt = new Date().toISOString();

        // Tập người nhận sau khi xoay ĐÚNG BẰNG danh sách gửi lên (D50).
        const existing = [...shares.values()].filter((share) => share.noteId === noteId);
        for (const share of existing) {
          if (!emails.includes(share.recipientEmail)) shares.delete(share.id);
        }
        for (const entry of keep) {
          const old = existing.find((share) => share.recipientEmail === entry.recipientEmail);
          const id = old ? old.id : globalThis.crypto.randomUUID();
          shares.set(id, {
            id,
            noteId,
            senderEmail: email,
            recipientEmail: entry.recipientEmail,
            sharePackage: entry.sharePackage,
            createdAt: old ? old.createdAt : new Date().toISOString(),
          });
        }
        return assertSchema(NoteWriteResponse, writeResult(record), 'POST /api/notes/:id/rotate');
      },

      async listNoteShares(noteId) {
        const email = requireSession();
        const record = notes.get(noteId);
        // Người được chia sẻ không được biết note còn chia sẻ cho ai khác.
        if (!record || record.ownerEmail !== email) throw notFound();
        const body = [...shares.values()]
          .filter((share) => share.noteId === noteId)
          .map((share) => ({
            id: share.id,
            recipientEmail: share.recipientEmail,
            createdAt: share.createdAt,
          }));
        return assertSchema(NoteShareListResponse, body, 'GET /api/notes/:id/shares');
      },

      async deleteShare(shareId) {
        const email = requireSession();
        const share = shares.get(shareId);
        // Chỉ người gửi; người nhận hay người ngoài đều nhận NOT_FOUND.
        if (!share || share.senderEmail !== email) throw notFound();
        shares.delete(shareId);
      },

      async listSharedWithMe() {
        const email = requireSession();
        const body = [...shares.values()]
          .filter((s) => s.recipientEmail === email)
          .map((s) => ({
            id: s.id,
            noteId: s.noteId,
            senderEmail: s.senderEmail,
            createdAt: s.createdAt,
          }));
        return assertSchema(ShareListResponse, body, 'GET /api/shares');
      },
    };
  }

  return { connect };
}

/**
 * Một server giả với đúng một kết nối — đủ cho trường hợp chỉ có một người dùng.
 * Cần nhiều người dùng cùng lúc thì dùng createMemoryServer().connect().
 *
 * @returns {import('./transportType.js').Transport}
 */
export function createMemoryTransport() {
  return createMemoryServer().connect();
}
