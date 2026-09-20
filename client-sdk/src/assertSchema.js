/**
 * assertSchema.js
 * ---------------
 * Kiểm tra một giá trị (thường là response JSON từ server) có khớp schema
 * TypeBox trong `@secure-notes/shared` hay không, bằng Value.Check — không sinh
 * code lúc chạy nên không vi phạm CSP (D06).
 *
 * Sai schema thì ném lỗi rõ ràng ngay tại đây, thay vì để code phía sau (giải
 * mã, base64...) ném ra lỗi mơ hồ khó lần ra nguyên nhân.
 */

import { Value } from '@sinclair/typebox/value';

/**
 * @param {import('@sinclair/typebox').TSchema} schema
 * @param {unknown} value
 * @param {string} contextLabel ví dụ "GET /api/notes/:id" — để thông báo lỗi dễ đọc hơn.
 * @returns {unknown} chính giá trị đầu vào, không đổi gì, để tiện viết `return assertSchema(...)`.
 */
export function assertSchema(schema, value, contextLabel) {
  if (Value.Check(schema, value)) {
    return value;
  }
  const firstError = Value.Errors(schema, value).First();
  const detail = firstError ? `${firstError.path}: ${firstError.message}` : 'không rõ chi tiết';
  throw new Error(
    `Phản hồi từ server không đúng định dạng mong đợi (${contextLabel}) - ${detail}. ` +
      'Đây có thể là dấu hiệu server bị lỗi hoặc bị can thiệp, từ chối xử lý tiếp cho an toàn.',
  );
}
