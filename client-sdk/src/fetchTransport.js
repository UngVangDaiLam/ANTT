/**
 * fetchTransport.js
 * -----------------
 * Transport THAT dung fetch(), thay the memoryTransport.js khi backend that
 * da san sang. KHONG sua client.js - chi can doi noi khoi tao:
 *
 *   import { createMemoryTransport } from './memoryTransport.js';
 *   const client = new SecureNoteClient(createMemoryTransport());
 *
 * thanh:
 *
 *   import { createFetchTransport } from './fetchTransport.js';
 *   const client = new SecureNoteClient(createFetchTransport('https://api.diachi-that.com'));
 *
 * Moi response tu server deu duoc kiem tra hinh dang bang TypeBox (xem
 * schemas.js + assertSchema.js) TRUOC KHI tra ve cho client.js dung - day la
 * phong thu chong "server doc hai" tra ve du lieu sai dinh dang hoac co truong
 * la (vi du __proto__) da nhac trong khung do an.
 *
 * QUAN TRONG: dung { credentials: 'include' } de trinh duyet tu dong gui kem
 * cookie session (httpOnly) ma backend thiet lap luc dang nhap - KHONG tu tay
 * gan header Authorization/token o day.
 */

import {
  GetSaltResponseSchema,
  LoginResponseSchema,
  UserKeysResponseSchema,
  CreateNoteResponseSchema,
  NoteListResponseSchema,
  NoteRecordSchema,
  ShareResponseSchema,
  SharedWithMeResponseSchema,
  ShareRecordSchema,
} from './schemas.js';
import { assertSchema } from './assertSchema.js';

/**
 * @param {string} baseUrl
 * @returns {import('./transportType.js').Transport}
 */
export function createFetchTransport(baseUrl) {
  async function callApi(method, path, body) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'include', // gui kem cookie session httpOnly
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || `API loi: ${method} ${path} -> HTTP ${response.status}`);
    }

    // Mot so endpoint (vi du GET /users/:email/salt) co the tra ve chuoi
    // thuan thay vi JSON - backend can thong nhat truoc, o day gia dinh JSON.
    return response.json();
  }

  return {
    async register(payload) {
      await callApi('POST', '/register', payload);
    },

    async getSalt(email) {
      const data = await callApi('GET', `/users/${encodeURIComponent(email)}/salt`);
      assertSchema(GetSaltResponseSchema, data, 'GET /users/:email/salt');
      return data.saltB64;
    },

    async login({ email, authKeyB64 }) {
      const data = await callApi('POST', '/login', { email, authKeyB64 });
      return assertSchema(LoginResponseSchema, data, 'POST /login');
    },

    async changePassword(payload) {
      return callApi('POST', '/change-password', payload);
    },

    async getUserKeys(email) {
      const data = await callApi('GET', `/users/${encodeURIComponent(email)}/keys`);
      return assertSchema(UserKeysResponseSchema, data, 'GET /users/:email/keys');
    },

    async createNote({ ownerEmail, nonce, ciphertext, wrappedNoteKeyForOwner }) {
      const data = await callApi('POST', '/notes', {
        ownerEmail,
        nonce,
        ciphertext,
        wrappedNoteKeyForOwner,
      });
      return assertSchema(CreateNoteResponseSchema, data, 'POST /notes');
    },

    async listNotes(ownerEmail) {
      const data = await callApi('GET', `/notes?owner=${encodeURIComponent(ownerEmail)}`);
      return assertSchema(NoteListResponseSchema, data, 'GET /notes');
    },

    async getNote(noteId) {
      const data = await callApi('GET', `/notes/${encodeURIComponent(noteId)}`);
      return assertSchema(NoteRecordSchema, data, 'GET /notes/:id');
    },

    async shareNote(payload) {
      const { noteId, ...rest } = payload;
      const data = await callApi('POST', `/notes/${encodeURIComponent(noteId)}/share`, rest);
      return assertSchema(ShareResponseSchema, data, 'POST /notes/:id/share');
    },

    async listSharedWithMe(recipientEmail) {
      const data = await callApi('GET', `/shares?recipient=${encodeURIComponent(recipientEmail)}`);
      return assertSchema(SharedWithMeResponseSchema, data, 'GET /shares');
    },

    async getShare(shareId) {
      const data = await callApi('GET', `/shares/${encodeURIComponent(shareId)}`);
      return assertSchema(ShareRecordSchema, data, 'GET /shares/:id');
    },
  };
}
