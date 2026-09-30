/**
 * Chuyển lỗi từ client-sdk thành lời nhắn cho người dùng. Luôn dựa vào `code` (D29), không dò
 * chuỗi thông báo, và không bao giờ đưa thông điệp nội bộ (tên hàm, chi tiết kỹ thuật) ra màn hình.
 *
 * `tone`:
 *  - 'error'    thao tác thất bại, người dùng có thể thử lại hoặc sửa đầu vào;
 *  - 'security' có dấu hiệu máy chủ lỗi hoặc bị can thiệp — cần nổi bật, KHÔNG phải lỗi của người dùng;
 *  - 'session'  phiên đã hết, cần đăng nhập lại.
 */

const MESSAGES = {
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  EMAIL_TAKEN: 'Email này đã có tài khoản. Hãy chuyển sang Đăng nhập.',
  RATE_LIMITED: 'Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
  NOT_FOUND: 'Không tìm thấy. Ghi chú có thể đã bị xóa hoặc bạn không còn quyền truy cập.',
  VERSION_CONFLICT: 'Ghi chú vừa được sửa ở nơi khác, nên bản của bạn chưa được lưu.',
  PAYLOAD_TOO_LARGE: 'Nội dung quá lớn để lưu.',
  VALIDATION_ERROR: 'Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.',
  FORBIDDEN: 'Yêu cầu bị từ chối.',
  INTERNAL_ERROR: 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.',
};

const SECURITY_MESSAGES = {
  INTEGRITY_ERROR:
    'Dữ liệu nhận từ máy chủ không hợp lệ hoặc đã bị sửa, nên ứng dụng đã từ chối hiển thị để bảo vệ bạn.',
  ROLLBACK_DETECTED:
    'Máy chủ gửi về một phiên bản cũ hơn bản bạn đã thấy. Ứng dụng đã từ chối để tránh bạn đọc hoặc sửa nhầm dữ liệu cũ.',
};

/**
 * @param {unknown} err lỗi bất kỳ bắt được từ client-sdk
 * @returns {{ tone: 'error' | 'security' | 'session', message: string }}
 */
export function describeError(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;

  if (Object.hasOwn(SECURITY_MESSAGES, code))
    return { tone: 'security', message: SECURITY_MESSAGES[code] };
  if (code === 'UNAUTHENTICATED') {
    return { tone: 'session', message: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.' };
  }
  // Riêng lỗi mật khẩu yếu, thông điệp của SDK đã cụ thể và thân thiện (ví dụ "ít nhất 8 ký tự").
  if (code === 'WEAK_PASSWORD' && typeof err.message === 'string') {
    return { tone: 'error', message: err.message };
  }
  if (Object.hasOwn(MESSAGES, code)) return { tone: 'error', message: MESSAGES[code] };

  // fetch() ném TypeError khi mất mạng hoặc máy chủ không phản hồi.
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return { tone: 'error', message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' };
  }
  return { tone: 'error', message: 'Đã có lỗi xảy ra. Vui lòng thử lại.' };
}
