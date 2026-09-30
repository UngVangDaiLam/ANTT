/**
 * [Lâm] Điểm export duy nhất mà web/ được phép gọi.
 *
 * Hình dạng dữ liệu trao đổi với server nằm trong `@secure-notes/shared`
 * (schema TypeBox dùng chung với server) và được mô tả ở `docs/API.md`.
 * client-sdk KHÔNG định nghĩa schema riêng — có hai bản schema là sớm muộn
 * cũng lệch nhau.
 */
export { SecureNoteClient } from './client.js';
export { createFetchTransport } from './fetchTransport.js';
export { createMemoryTransport, createMemoryServer } from './memoryTransport.js';
export { ApiError } from './apiError.js';
export { checkPassword } from './passwordPolicy.js';
export { createLocalStorageVersionStore, createMemoryVersionStore } from './versionStore.js';

// web/ chỉ được import client-sdk (ranh giới kiến trúc), nên các hằng số giao diện cần được export
// lại từ đây thay vì import thẳng từ shared/.
export { AUTO_LOCK_MS, PASSWORD_POLICY } from '@secure-notes/shared';
