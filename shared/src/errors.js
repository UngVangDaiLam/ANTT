/**
 * Định dạng lỗi thống nhất: { code, message }.
 * client-sdk dựa vào `code` để chuyển thành thông báo cho giao diện.
 */
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: { status: 400, message: 'Dữ liệu gửi lên không hợp lệ.' },
  INVALID_CREDENTIALS: { status: 401, message: 'Email hoặc mật khẩu không đúng.' },
  UNAUTHENTICATED: { status: 401, message: 'Bạn chưa đăng nhập hoặc phiên đã hết hạn.' },
  FORBIDDEN: { status: 403, message: 'Bạn không có quyền thực hiện thao tác này.' },
  // Truy cập note không thuộc về mình -> trả NOT_FOUND, KHÔNG trả FORBIDDEN,
  // để không xác nhận note đó có tồn tại.
  NOT_FOUND: { status: 404, message: 'Không tìm thấy.' },
  EMAIL_TAKEN: { status: 409, message: 'Email này đã được đăng ký.' },
  // D17: noteId do client sinh, server từ chối id trùng. Về lý thuyết lộ việc
  // "id này đã tồn tại", nhưng UUID v4 không đoán được nên không dùng để dò được gì.
  NOTE_ID_TAKEN: { status: 409, message: 'Note id này đã tồn tại, hãy thử lại.' },
  VERSION_CONFLICT: { status: 409, message: 'Note đã bị thay đổi ở nơi khác, hãy tải lại.' },
  SHARE_REVOKED: { status: 410, message: 'Quyền truy cập note này đã bị thu hồi.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Dữ liệu vượt quá kích thước cho phép.' },
  RATE_LIMITED: { status: 429, message: 'Bạn thao tác quá nhanh, hãy thử lại sau.' },
  INTERNAL_ERROR: { status: 500, message: 'Lỗi máy chủ.' },
});

export class AppError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES} code
   * @param {string} [message] ghi đè thông điệp mặc định
   */
  constructor(code, message) {
    const def = ERROR_CODES[code] ?? ERROR_CODES.INTERNAL_ERROR;
    super(message ?? def.message);
    this.code = ERROR_CODES[code] ? code : 'INTERNAL_ERROR';
    this.statusCode = def.status;
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}
