import {
  SecureNoteClient,
  createFetchTransport,
  createLocalStorageVersionStore,
} from '@secure-notes/client-sdk';

const transport = createFetchTransport();

// D20: nhớ version cao nhất đã thấy của từng note qua cả những lần tải lại trang, để phát hiện
// server trả về bản cũ. Chỉ lưu id note và số version, không lưu khóa hay nội dung.
export const client = new SecureNoteClient(transport, {
  versionStore: createLocalStorageVersionStore(),
});
