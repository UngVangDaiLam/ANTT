/**
 * [Lâm] Điểm export duy nhất mà web/ được phép gọi.
 *
 * TODO (chưa xong, xem docs/DECISIONS.md D34 và ghi chú trong fetchTransport.js):
 *   - Payload gửi lên trong client.js/fetchTransport.js còn dùng tên trường cũ
 *     (saltB64, publicKeyB64, ownerEmail...), lệch với schema RegisterRequest
 *     hiện tại trong shared/src/schemas.js. Cần Lâm rà lại toàn bộ payload.
 *   - fetchTransport.js còn gọi một số đường dẫn/endpoint khác docs/API.md
 *     (vd. GET /notes?owner=..., POST /notes/:id/share) - API.md mới là hợp đồng.
 */
export { SecureNoteClient } from './client.js';
export { createFetchTransport } from './fetchTransport.js';
export { createMemoryTransport } from './memoryTransport.js';
