/**
 * memoryTransport.js
 * ------------------
 * "Server gia" chay trong bo nho (khong luu gi xuong dia, mat het khi tat
 * chuong trinh) - dung de A tu phat trien va test client SDK (client.js) MA
 * KHONG CAN cho B xay xong backend that.
 *
 * Day chinh la "hop dong API" (API contract) ma B se phai cai dat lai bang
 * Express + database that: cung ten ham, cung tham so vao/ra. Khi B xong
 * backend that, chi can thay transport nay bang mot transport khac goi
 * fetch() toi API that, client.js KHONG CAN SUA GI CA.
 *
 * QUAN TRONG: day KHONG PHAI backend that, chi la mo phong de test. Khong
 * co ma hoa mat khau phia server (xem ghi chu trong login()), khong co
 * rate-limit, khong luu ben vung - nhung viec do la trach nhiem cua B khi
 * lam backend that.
 */

function createMemoryTransport() {
  const users = new Map(); // email -> ho so tai khoan (chi chua du lieu da duoc A ma hoa san)
  const notes = new Map(); // noteId -> ho so note (chi chua ciphertext)
  const shares = new Map(); // shareId -> ho so goi chia se

  let noteCounter = 0;
  let shareCounter = 0;

  return {
    async register(payload) {
      if (users.has(payload.email)) {
        throw new Error('Email da duoc dang ky');
      }
      users.set(payload.email, { ...payload });
    },

    async getSalt(email) {
      const user = users.get(email);
      if (!user) throw new Error('Khong tim thay tai khoan');
      return user.saltB64;
    },

    async login({ email, authKeyB64 }) {
      const user = users.get(email);
      // Khong tiet lo "email khong ton tai" hay "sai mat khau" khac nhau -
      // gop chung 1 thong bao de tranh do email dang ky (user enumeration).
      if (!user) throw new Error('Sai email hoac mat khau');

      // GHI CHU CHO B: server THAT phai hash authKeyB64 them 1 lop (bcrypt/
      // Argon2id, salt rieng cua server) roi moi so sanh voi gia tri da hash
      // luu trong DB - KHONG so sanh truc tiep chuoi nhu o day. Ban mo phong
      // nay so sanh truc tiep chi de don gian hoa viec test SDK.
      if (user.authKeyB64 !== authKeyB64) throw new Error('Sai email hoac mat khau');

      return { ...user };
    },

    async changePassword({ email, saltB64, authKeyB64, wrappedVaultKey, wrappedPrivateKey, wrappedSigningPrivateKey }) {
      const user = users.get(email);
      if (!user) throw new Error('Khong tim thay tai khoan');
      // GHI CHU CHO B: server THAT phai kiem tra session/cookie hien tai dung
      // la cua chinh email nay truoc khi cho doi mat khau - khong duoc tin
      // tuong mu quang truong email client gui len.
      user.saltB64 = saltB64;
      user.authKeyB64 = authKeyB64;
      user.wrappedVaultKey = wrappedVaultKey;
      user.wrappedPrivateKey = wrappedPrivateKey;
      user.wrappedSigningPrivateKey = wrappedSigningPrivateKey;
    },

    async getUserKeys(email) {
      const user = users.get(email);
      if (!user) throw new Error('Khong tim thay tai khoan');
      return {
        publicKeyB64: user.publicKeyB64,
        signingPublicKeyB64: user.signingPublicKeyB64,
      };
    },

    async createNote({ ownerEmail, nonce, ciphertext, wrappedNoteKeyForOwner }) {
      noteCounter += 1;
      const noteId = 'note-' + noteCounter;
      notes.set(noteId, {
        noteId,
        ownerEmail,
        nonce,
        ciphertext,
        wrappedNoteKeyForOwner,
        createdAt: Date.now(),
      });
      return { noteId };
    },

    async listNotes(ownerEmail) {
      return [...notes.values()]
        .filter((n) => n.ownerEmail === ownerEmail)
        .map((n) => ({ noteId: n.noteId, createdAt: n.createdAt }));
    },

    async getNote(noteId) {
      const record = notes.get(noteId);
      if (!record) throw new Error('Khong tim thay note');
      return { ...record };
    },

    async shareNote({ noteId, senderEmail, recipientEmail, ephemeralPublicKey, nonce, ciphertext, signature }) {
      const noteRecord = notes.get(noteId);
      if (!noteRecord) throw new Error('Khong tim thay note');
      if (noteRecord.ownerEmail !== senderEmail) {
        throw new Error('Ban khong phai chu note nay, khong the chia se');
      }
      shareCounter += 1;
      const shareId = 'share-' + shareCounter;
      shares.set(shareId, {
        shareId,
        noteId,
        senderEmail,
        recipientEmail,
        ephemeralPublicKey,
        nonce,
        ciphertext,
        signature,
        // Luu kem noi dung note da ma hoa de nguoi nhan doc duoc ma khong
        // can quyen truy cap note goc (ho khong phai chu note).
        noteNonce: noteRecord.nonce,
        noteCiphertext: noteRecord.ciphertext,
        createdAt: Date.now(),
      });
      return { shareId };
    },

    async listSharedWithMe(recipientEmail) {
      return [...shares.values()]
        .filter((s) => s.recipientEmail === recipientEmail)
        .map((s) => ({ shareId: s.shareId, noteId: s.noteId, senderEmail: s.senderEmail, createdAt: s.createdAt }));
    },

    async getShare(shareId) {
      const record = shares.get(shareId);
      if (!record) throw new Error('Khong tim thay goi chia se');
      return { ...record };
    },
  };
}

module.exports = { createMemoryTransport };