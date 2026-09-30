/**
 * versionStore.js
 * ---------------
 * Nơi client nhớ version CAO NHẤT đã thấy của từng note, để phát hiện server trả về một
 * bản cũ hơn (rollback, D20).
 *
 * Associated Data (D19) đã chặn việc server khai sai version cho một ciphertext. Nhưng một
 * bản cũ TRỌN VẸN (ciphertext cũ + version cũ, khớp nhau) vẫn giải mã được bình thường;
 * chỉ có cách so với cái client đã từng thấy mới phát hiện được.
 *
 * Chỉ lưu id note và số version — không lưu khóa, không lưu nội dung (D20: version không
 * phải bí mật). `scope` là email người dùng, để hai người dùng chung một trình duyệt không
 * lẫn dữ liệu của nhau.
 *
 * Giới hạn: lần đầu đọc một note trên thiết bị mới thì chưa có gì để so.
 *
 * @typedef {object} VersionStore
 * @property {(scope: string, noteId: string) => number | undefined} get
 * @property {(scope: string, noteId: string, version: number) => void} set
 */

const entryKey = (scope, noteId) => `${scope}|${noteId}`;

/**
 * Lưu trong bộ nhớ: mất khi tải lại trang. Mặc định của SecureNoteClient.
 * @returns {VersionStore}
 */
export function createMemoryVersionStore() {
  const seen = new Map();
  return {
    get: (scope, noteId) => seen.get(entryKey(scope, noteId)),
    set: (scope, noteId, version) => seen.set(entryKey(scope, noteId), version),
  };
}

/**
 * Lưu trong localStorage: còn nguyên sau khi tải lại trang hoặc đăng nhập lại.
 *
 * Không tin dữ liệu đọc ra: localStorage có thể bị extension hay người dùng sửa. Dữ liệu
 * hỏng thì coi như trống (chỉ mất khả năng phát hiện rollback, không làm sai gì khác), và
 * chỉ nhận số nguyên dương. localStorage có thể ném lỗi (chế độ riêng tư, đầy bộ nhớ):
 * khi đó vẫn nhớ trong bộ nhớ như bản mặc định.
 *
 * @param {Storage} [storage] mặc định là globalThis.localStorage
 * @param {string} [storageKey]
 * @returns {VersionStore}
 */
export function createLocalStorageVersionStore(
  storage = globalThis.localStorage,
  storageKey = 'secure-notes:seen-versions',
) {
  /** Map thay vì object thường: khóa lạ như "__proto__" không đụng tới prototype. */
  let seen = new Map();
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      seen = new Map(Object.entries(parsed).filter(([, v]) => Number.isSafeInteger(v) && v >= 1));
    }
  } catch {
    // Dữ liệu hỏng hoặc không đọc được: bắt đầu lại từ trống.
  }

  return {
    get: (scope, noteId) => seen.get(entryKey(scope, noteId)),
    set(scope, noteId, version) {
      seen.set(entryKey(scope, noteId), version);
      try {
        storage.setItem(storageKey, JSON.stringify(Object.fromEntries(seen)));
      } catch {
        // Không ghi được thì vẫn nhớ trong bộ nhớ cho tới khi tải lại trang.
      }
    },
  };
}
