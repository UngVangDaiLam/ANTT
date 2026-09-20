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
  ChangePasswordRequest,
  KDF_DEFAULTS,
  LoginRequest,
  NoteCreateRequest,
  NoteListResponse,
  NoteResponse,
  NoteWriteResponse,
  RegisterRequest,
  SaltResponse,
  SelfAccountResponse,
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

  /** Một kết nối = một trình duyệt, có phiên đăng nhập riêng (thay cho cookie). */
  function connect() {
    let sessionEmail = null;

    function requireSession() {
      if (!sessionEmail) throw new ApiError('UNAUTHENTICATED', 'Chưa đăng nhập.');
      return sessionEmail;
    }

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
        return assertSchema(SaltResponse, body, 'GET /api/users/:email/salt');
      },

      async login(payload) {
        checkRequest(LoginRequest, payload, 'POST /api/login');
        const user = users.get(normalizeEmail(payload.email));
        // Không phân biệt "email không tồn tại" với "sai mật khẩu".
        if (!user || user.authKey !== payload.authKey) {
          throw new ApiError('INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
        }
        sessionEmail = user.email;
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
        sessionEmail = null;
      },

      async changePassword(payload) {
        const email = requireSession();
        checkRequest(ChangePasswordRequest, payload, 'POST /api/change-password');
        const user = users.get(email);
        if (user.authKey !== payload.oldAuthKey) {
          throw new ApiError('INVALID_CREDENTIALS', 'Mật khẩu cũ không đúng.');
        }
        user.salt = payload.salt;
        user.kdfParams = payload.kdfParams;
        user.authKey = payload.authKey;
        user.wrappedVaultKey = payload.wrappedVaultKey;
        user.wrappedX25519PrivateKey = payload.wrappedX25519PrivateKey;
        user.wrappedEd25519PrivateKey = payload.wrappedEd25519PrivateKey;
        // Server thật còn hủy các phiên khác của người này (D25).
      },

      async getUserKeys(email) {
        requireSession();
        const user = users.get(normalizeEmail(email));
        if (!user) throw new ApiError('NOT_FOUND', 'Không tìm thấy người dùng này.');
        return assertSchema(
          UserKeysResponse,
          { x25519PublicKey: user.x25519PublicKey, ed25519PublicKey: user.ed25519PublicKey },
          'GET /api/users/:email/keys',
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
