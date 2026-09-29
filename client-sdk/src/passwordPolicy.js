/**
 * passwordPolicy.js
 * -----------------
 * Chính sách mật khẩu (ASVS 6.2.1, 6.2.4, 6.2.5, 6.2.8). Phải kiểm tra ở CLIENT vì server không bao giờ
 * thấy mật khẩu — chỉ nhận authKey đã dẫn xuất qua Argon2id. Hằng số ở `PASSWORD_POLICY` trong
 * shared/src/config.js.
 *
 * Toàn bộ sức mạnh của Argon2id (64 MB, ~0,3 giây mỗi lần thử) vô nghĩa nếu mật khẩu là "password1":
 * kẻ trộm database thử danh sách mật khẩu phổ biến trước tiên, và mật khẩu đó nằm ngay đầu danh sách.
 */

import { PASSWORD_POLICY } from '@secure-notes/shared';
import { ApiError } from './apiError.js';
import { COMMON_PASSWORDS } from './commonPasswords.js';

/**
 * @typedef {'TOO_SHORT' | 'TOO_COMMON'} PasswordProblem
 *
 * @typedef {object} PasswordCheck
 * @property {boolean} ok mật khẩu có được chấp nhận hay không
 * @property {PasswordProblem[]} problems lý do bị từ chối (rỗng nếu ok)
 * @property {number} length số ký tự, tính theo Unicode code point
 * @property {boolean} meetsRecommendation đạt độ dài khuyến nghị (15) hay chưa — chỉ để gợi ý
 */

/**
 * Kiểm tra mật khẩu mà KHÔNG ném lỗi, để giao diện hiện phản hồi ngay khi người dùng đang gõ.
 *
 * - Độ dài tính theo ký tự Unicode: "mật" là 3 ký tự, một emoji là 1 ký tự.
 * - Không đòi chữ hoa, số hay ký tự đặc biệt (6.2.5).
 * - Không trim, không đổi mật khẩu (6.2.8): "   ab" có 5 ký tự. Chỉ phép SO SÁNH với danh sách phổ
 *   biến là không phân biệt hoa thường, để "PASSWORD1" cũng bị chặn như "password1".
 *
 * @param {string} password
 * @returns {PasswordCheck}
 */
export function checkPassword(password) {
  if (typeof password !== 'string') throw new TypeError('password phải là chuỗi');
  const length = [...password].length;
  const problems = [];
  if (length < PASSWORD_POLICY.MIN_LENGTH) problems.push('TOO_SHORT');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) problems.push('TOO_COMMON');
  return {
    ok: problems.length === 0,
    problems,
    length,
    meetsRecommendation: length >= PASSWORD_POLICY.RECOMMENDED_LENGTH,
  };
}

const MESSAGES = {
  TOO_SHORT: `Mật khẩu phải có ít nhất ${PASSWORD_POLICY.MIN_LENGTH} ký tự.`,
  TOO_COMMON: 'Mật khẩu này nằm trong danh sách mật khẩu phổ biến bị lộ, hãy chọn mật khẩu khác.',
};

/**
 * Ném `ApiError('WEAK_PASSWORD')` nếu mật khẩu không đạt. Gọi TRƯỚC Argon2id: vừa khỏi tốn ~0,3 giây
 * dẫn xuất khóa vô ích, vừa không gửi gì lên server.
 * @param {string} password
 */
export function assertAcceptablePassword(password) {
  const result = checkPassword(password);
  if (result.ok) return;
  const error = new ApiError('WEAK_PASSWORD', result.problems.map((p) => MESSAGES[p]).join(' '));
  error.problems = result.problems;
  throw error;
}
