/**
 * transportType.js
 * ----------------
 * Chỉ chứa JSDoc typedef cho "Transport", không có code chạy. Đây là bản mô tả
 * gọn của `docs/API.md` dành cho người viết transport mới hoặc đọc lại để biết
 * client gọi hàm nào, gửi gì, nhận gì.
 *
 * LƯU Ý (D16): các thao tác cần đăng nhập KHÔNG nhận email/ownerEmail làm tham
 * số. Danh tính do server lấy từ phiên; transport chỉ gửi kèm cookie. Email chỉ
 * xuất hiện ở những chỗ nó thật sự là dữ liệu đầu vào: tra salt, tra khóa công
 * khai của người khác, và chọn người nhận khi chia sẻ.
 *
 * Hình dạng chính xác của từng payload/response nằm trong
 * `shared/src/schemas.js` — đó mới là nguồn sự thật, JSDoc ở đây chỉ để đọc nhanh.
 *
 * @typedef {{nonce: string, ciphertext: string}} Sealed
 *
 * @typedef {object} Transport
 * @property {(payload: object) => Promise<void>} register POST /api/register
 * @property {(email: string) => Promise<{salt: string, kdfParams: {opslimit: number, memlimit: number}}>} getSalt
 *   GET /api/users/:email/salt — email chưa đăng ký vẫn trả salt giả (D15)
 * @property {(payload: {email: string, authKey: string}) => Promise<object>} login
 *   POST /api/login — đặt cookie phiên, trả về khóa đã bọc của chính mình
 * @property {() => Promise<void>} logout POST /api/logout
 * @property {(payload: object) => Promise<void>} changePassword POST /api/change-password
 * @property {(email: string) => Promise<{x25519PublicKey: string, ed25519PublicKey: string}>} getUserKeys
 *   GET /api/users/:email/keys
 * @property {(payload: object) => Promise<{id: string, version: number, updatedAt: string}>} createNote
 *   POST /api/notes
 * @property {() => Promise<Array<object>>} listNotes GET /api/notes — không kèm nội dung
 * @property {(noteId: string) => Promise<object>} getNote
 *   GET /api/notes/:id — chủ note nhận wrappedNoteKey, người được chia sẻ nhận share (D22)
 * @property {(noteId: string, payload: object) => Promise<{id: string}>} shareNote
 *   POST /api/notes/:id/shares
 * @property {() => Promise<Array<object>>} listSharedWithMe GET /api/shares
 */

export {};
