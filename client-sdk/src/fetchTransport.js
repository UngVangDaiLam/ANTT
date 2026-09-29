/**
 * fetchTransport.js
 * -----------------
 * Transport THẬT dùng fetch(), nói chuyện với server theo đúng `docs/API.md`.
 * Đổi transport là đổi đúng một dòng ở nơi khởi tạo, client.js không phải sửa:
 *
 *   const client = new SecureNoteClient(createMemoryTransport());   // tự test
 *   const client = new SecureNoteClient(createFetchTransport());    // server thật
 *
 * Mọi response đều được kiểm tra bằng schema trong `@secure-notes/shared`
 * (Value.Check, không dùng ajv vì ajv sinh code bằng new Function và bị CSP
 * chặn — D06). Đây là phòng thủ chống "server độc hại": dùng CHUNG một bộ
 * schema với server, nên client không thể vô tình chấp nhận hình dạng dữ liệu
 * mà server không bao giờ được phép trả về.
 *
 * QUAN TRỌNG: dùng `credentials: 'include'` để trình duyệt tự gửi kèm cookie
 * phiên (httpOnly) — KHÔNG tự gắn header Authorization hay đọc token bằng JS.
 */

import { Value } from '@sinclair/typebox/value';
import {
  ErrorBody,
  NoteListResponse,
  NoteShareListResponse,
  NoteResponse,
  NoteWriteResponse,
  SaltResponse,
  SelfAccountResponse,
  ShareCreatedResponse,
  ShareListResponse,
  UserKeysResponse,
} from '@secure-notes/shared';
import { assertSchema } from './assertSchema.js';
import { ApiError } from './apiError.js';

/**
 * @param {string} [baseUrl] Mặc định rỗng: giao diện và API cùng origin
 *   (Vite proxy khi dev, Caddy khi deploy — D07), nên đường dẫn tương đối là đủ.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch] Hàm fetch dùng để gọi API. Giao diện KHÔNG cần truyền: mặc
 *   định là fetch của trình duyệt. Chỉ test tích hợp dùng, để chạy trên Node với cookie jar riêng
 *   cho từng "trình duyệt" giả lập.
 * @returns {import('./transportType.js').Transport}
 */
export function createFetchTransport(baseUrl = '', { fetch: fetchImpl = globalThis.fetch } = {}) {
  async function callApi(method, path, body) {
    // Gọi dạng hàm trần `fetchImpl(...)`, KHÔNG phải `options.fetch(...)`: trình duyệt ném
    // "Illegal invocation" nếu fetch bị gọi với `this` khác window.
    const response = await fetchImpl(`${baseUrl}/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      credentials: 'include', // gửi kèm cookie phiên httpOnly
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // 204 hoặc 201 body rỗng (ví dụ POST /register theo D36): không có gì để đọc.
    // Đọc dạng text rồi mới parse: khi có proxy hỏng hoặc trang lỗi HTML chen vào
    // giữa đường, JSON.parse sẽ ném SyntaxError khó hiểu thay vì một lỗi nói rõ
    // rằng phản hồi không phải JSON.
    const raw = await response.text();
    let data;
    try {
      data = raw === '' ? undefined : JSON.parse(raw);
    } catch {
      throw new ApiError(
        'INTERNAL_ERROR',
        `Phản hồi từ server không phải JSON (HTTP ${response.status}).`,
      );
    }

    if (!response.ok) {
      // Ngay cả thân lỗi cũng phải đúng định dạng { code, message } (D29);
      // sai định dạng thì coi như server hỏng, không lấy chuỗi lạ ra hiển thị.
      if (Value.Check(ErrorBody, data)) throw new ApiError(data.code, data.message);
      throw new ApiError(
        'INTERNAL_ERROR',
        `Server trả lỗi không đúng định dạng (HTTP ${response.status}).`,
      );
    }

    return data;
  }

  return {
    async register(payload) {
      await callApi('POST', '/register', payload);
    },

    async getSalt(email) {
      const data = await callApi('GET', `/users/${encodeURIComponent(email)}/salt`);
      return assertSchema(SaltResponse, data, 'GET /api/users/:email/salt');
    },

    async login(payload) {
      const data = await callApi('POST', '/login', payload);
      return assertSchema(SelfAccountResponse, data, 'POST /api/login');
    },

    async logout() {
      await callApi('POST', '/logout');
    },

    async changePassword(payload) {
      await callApi('POST', '/change-password', payload);
    },

    async getUserKeys(email) {
      const data = await callApi('GET', `/users/${encodeURIComponent(email)}/keys`);
      return assertSchema(UserKeysResponse, data, 'GET /api/users/:email/keys');
    },

    async createNote(payload) {
      const data = await callApi('POST', '/notes', payload);
      return assertSchema(NoteWriteResponse, data, 'POST /api/notes');
    },

    async listNotes() {
      const data = await callApi('GET', '/notes');
      return assertSchema(NoteListResponse, data, 'GET /api/notes');
    },

    async getNote(noteId) {
      const data = await callApi('GET', `/notes/${encodeURIComponent(noteId)}`);
      return assertSchema(NoteResponse, data, 'GET /api/notes/:id');
    },

    async updateNote(noteId, payload) {
      const data = await callApi('PUT', `/notes/${encodeURIComponent(noteId)}`, payload);
      return assertSchema(NoteWriteResponse, data, 'PUT /api/notes/:id');
    },

    async deleteNote(noteId) {
      await callApi('DELETE', `/notes/${encodeURIComponent(noteId)}`);
    },

    async rotateNote(noteId, payload) {
      const data = await callApi('POST', `/notes/${encodeURIComponent(noteId)}/rotate`, payload);
      return assertSchema(NoteWriteResponse, data, 'POST /api/notes/:id/rotate');
    },

    async listNoteShares(noteId) {
      const data = await callApi('GET', `/notes/${encodeURIComponent(noteId)}/shares`);
      return assertSchema(NoteShareListResponse, data, 'GET /api/notes/:id/shares');
    },

    async deleteShare(shareId) {
      await callApi('DELETE', `/shares/${encodeURIComponent(shareId)}`);
    },

    async shareNote(noteId, payload) {
      const data = await callApi('POST', `/notes/${encodeURIComponent(noteId)}/shares`, payload);
      return assertSchema(ShareCreatedResponse, data, 'POST /api/notes/:id/shares');
    },

    async listSharedWithMe() {
      const data = await callApi('GET', '/shares');
      return assertSchema(ShareListResponse, data, 'GET /api/shares');
    },
  };
}
