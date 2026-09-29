/**
 * apiError.js
 * -----------
 * Lỗi do server trả về, giữ nguyên `code` trong `shared/src/errors.js` (D29)
 * để giao diện quyết định hiển thị gì mà không phải dò theo chuỗi thông báo.
 */

export class ApiError extends Error {
  /**
   * @param {string} code mã lỗi, ví dụ 'NOT_FOUND', 'VERSION_CONFLICT'
   * @param {string} message thông báo đã sẵn sàng hiển thị cho người dùng
   */
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}
