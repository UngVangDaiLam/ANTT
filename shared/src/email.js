/** Chuẩn hóa email ở CẢ client lẫn server: bỏ khoảng trắng hai đầu, chuyển chữ thường. */
export function normalizeEmail(email) {
  if (typeof email !== 'string') throw new TypeError('email phải là chuỗi');
  return email.trim().toLowerCase();
}
