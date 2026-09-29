import { describe, expect, test } from 'vitest';
import { PASSWORD_POLICY } from '@secure-notes/shared';
import { ApiError } from '../src/apiError.js';
import { COMMON_PASSWORDS } from '../src/commonPasswords.js';
import { assertAcceptablePassword, checkPassword } from '../src/passwordPolicy.js';

describe('checkPassword', () => {
  test('7 ký tự bị từ chối, 8 ký tự được nhận (ASVS 6.2.1)', () => {
    expect(checkPassword('zx8!kq4')).toMatchObject({ ok: false, problems: ['TOO_SHORT'] });
    expect(checkPassword('zx8!kq4w')).toMatchObject({ ok: true, problems: [], length: 8 });
  });

  test('độ dài tính theo ký tự Unicode, không theo byte hay đơn vị UTF-16', () => {
    // "ệ" là 1 ký tự nhưng 3 byte UTF-8; 🔐 là 1 ký tự nhưng 2 đơn vị UTF-16.
    expect(checkPassword('ệệệệệệệ')).toMatchObject({ ok: false, length: 7 });
    expect(checkPassword('ệệệệệệệệ')).toMatchObject({ ok: true, length: 8 });
    expect('🔐🔐🔐🔐🔐🔐🔐'.length).toBe(14);
    expect(checkPassword('🔐🔐🔐🔐🔐🔐🔐')).toMatchObject({ ok: false, length: 7 });
    expect(checkPassword('🔐🔐🔐🔐🔐🔐🔐🔐')).toMatchObject({ ok: true, length: 8 });
  });

  test('mật khẩu phổ biến bị từ chối, không phân biệt hoa thường (ASVS 6.2.4)', () => {
    for (const common of ['password1', 'PASSWORD1', 'Password1', 'iloveyou', '1qaz2wsx']) {
      expect(checkPassword(common)).toMatchObject({ ok: false, problems: ['TOO_COMMON'] });
    }
  });

  test('mật khẩu đầu và cuối danh sách đều bị chặn', () => {
    const list = [...COMMON_PASSWORDS];
    expect(checkPassword(list[0]).problems).toContain('TOO_COMMON');
    expect(checkPassword(list[list.length - 1]).problems).toContain('TOO_COMMON');
  });

  test('không bắt buộc chữ hoa, số hay ký tự đặc biệt (ASVS 6.2.5)', () => {
    for (const ok of ['toi thich an pho bo', 'mật khẩu tiếng việt', 'correcthorsebatterystaple']) {
      expect(checkPassword(ok)).toMatchObject({ ok: true, problems: [] });
    }
  });

  test('giữ nguyên mật khẩu, không trim (ASVS 6.2.8)', () => {
    // 3 dấu cách + "ab" + 3 dấu cách = 8 ký tự: nếu bị trim sẽ còn 2 và bị từ chối.
    expect(checkPassword('   ab   ')).toMatchObject({ ok: true, length: 8 });
    // Khoảng trắng là một phần của mật khẩu, nên " password1" không phải "password1".
    expect(checkPassword(' password1').ok).toBe(true);
  });

  test('khuyến nghị 15 ký tự chỉ là gợi ý, không chặn', () => {
    expect(checkPassword('a'.repeat(6) + 'zq9x8w7v')).toMatchObject({
      ok: true,
      meetsRecommendation: false,
    });
    expect(checkPassword('mot cau kha dai ne')).toMatchObject({
      ok: true,
      meetsRecommendation: true,
    });
  });

  test('đầu vào không phải chuỗi thì báo lỗi lập trình, không coi là mật khẩu yếu', () => {
    expect(() => checkPassword(undefined)).toThrow(TypeError);
    expect(() => checkPassword(12345678)).toThrow(TypeError);
  });
});

describe('assertAcceptablePassword', () => {
  test('mật khẩu yếu ném ApiError WEAK_PASSWORD kèm lý do', () => {
    let error;
    try {
      assertAcceptablePassword('abc');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('WEAK_PASSWORD');
    expect(error.problems).toEqual(['TOO_SHORT']);
    expect(error.message).toContain(`${PASSWORD_POLICY.MIN_LENGTH} ký tự`);
  });

  test('mật khẩu đạt thì không ném gì', () => {
    expect(() => assertAcceptablePassword('mot cau kha dai ne')).not.toThrow();
  });
});

describe('danh sách mật khẩu phổ biến đã sinh (src/commonPasswords.js)', () => {
  test('đúng số lượng theo chính sách, không trùng', () => {
    expect(COMMON_PASSWORDS.size).toBe(PASSWORD_POLICY.COMMON_LIST_SIZE);
  });

  test('mọi mục đều thỏa độ dài tối thiểu và đã ở dạng chữ thường', () => {
    for (const password of COMMON_PASSWORDS) {
      expect([...password].length).toBeGreaterThanOrEqual(PASSWORD_POLICY.MIN_LENGTH);
      expect(password).toBe(password.toLowerCase());
    }
  });
});
