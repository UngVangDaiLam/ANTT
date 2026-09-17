/**
 * fetchTransport.js
 * -----------------
 * MAU (template) transport thay cho memoryTransport.js khi B da xong
 * backend that. KHONG sua src/client.js - chi can doi:
 *
 *   const { createMemoryTransport } = require('./memoryTransport');
 *   const client = new SecureNoteClient(createMemoryTransport());
 *
 * thanh:
 *
 *   const { createFetchTransport } = require('./fetchTransport');
 *   const client = new SecureNoteClient(createFetchTransport('https://api.diachi-that-cua-B.com'));
 *
 * File nay CHUA CHAY DUOC THAT vi API cua B chua ton tai - day la ban mau de
 * B biet chinh xac client se goi endpoint nao, gui gi, mong doi nhan lai gi.
 * Khi B xong, A/C dieu chinh lai URL va credentials cho dung roi test lai.
 *
 * QUAN TRONG: dung { credentials: 'include' } de trinh duyet tu dong gui kem
 * cookie session (httpOnly) ma B thiet lap luc dang nhap - KHONG tu tay gan
 * header Authorization/token o day.
 */

function createFetchTransport(baseUrl) {
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
    // thuan thay vi JSON - B va A can thong nhat truoc, o day gia dinh JSON.
    return response.json();
  }

  return {
    async register(payload) {
      await callApi('POST', '/register', payload);
    },

    async getSalt(email) {
      const data = await callApi('GET', `/users/${encodeURIComponent(email)}/salt`);
      return data.saltB64;
    },

    async login({ email, authKeyB64 }) {
      return callApi('POST', '/login', { email, authKeyB64 });
    },

    async changePassword(payload) {
      return callApi('POST', '/change-password', payload);
    },

    async getUserKeys(email) {
      return callApi('GET', `/users/${encodeURIComponent(email)}/keys`);
    },

    async createNote({ ownerEmail, nonce, ciphertext, wrappedNoteKeyForOwner }) {
      return callApi('POST', '/notes', { ownerEmail, nonce, ciphertext, wrappedNoteKeyForOwner });
    },

    async listNotes(ownerEmail) {
      return callApi('GET', `/notes?owner=${encodeURIComponent(ownerEmail)}`);
    },

    async getNote(noteId) {
      return callApi('GET', `/notes/${encodeURIComponent(noteId)}`);
    },

    async shareNote(payload) {
      const { noteId, ...rest } = payload;
      return callApi('POST', `/notes/${encodeURIComponent(noteId)}/share`, rest);
    },

    async listSharedWithMe(recipientEmail) {
      return callApi('GET', `/shares?recipient=${encodeURIComponent(recipientEmail)}`);
    },

    async getShare(shareId) {
      return callApi('GET', `/shares/${encodeURIComponent(shareId)}`);
    },
  };
}

module.exports = { createFetchTransport };