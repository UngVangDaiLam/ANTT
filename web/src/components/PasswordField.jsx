import { useId, useState } from 'react';
import { PASSWORD_POLICY, checkPassword } from '@secure-notes/client-sdk';
import { Icon } from './Icon.jsx';

/**
 * Ô mật khẩu có nút hiện/ẩn (ASVS 6.2.6 cho phép xem tạm thời). Không chặn dán và không tắt
 * trình quản lý mật khẩu (6.2.7): `autoComplete` đúng chuẩn để trình duyệt gợi ý/lưu mật khẩu.
 */
export function PasswordField({ label, value, onChange, autoComplete, describedBy, autoFocus }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-with-action">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          autoFocus={autoFocus}
          autoCapitalize="off"
          spellCheck={false}
          required
        />
        <button
          type="button"
          className="input-action"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>
    </div>
  );
}

/**
 * Báo độ mạnh mật khẩu ngay khi đang gõ, dùng đúng chính sách của SDK (D63) — giao diện không tự
 * đặt ra luật riêng, nên thứ được khen "đạt" ở đây chắc chắn cũng được SDK chấp nhận.
 */
export function PasswordStrength({ password, id }) {
  if (!password) {
    return (
      <p id={id} className="hint">
        Ít nhất {PASSWORD_POLICY.MIN_LENGTH} ký tự, nên từ {PASSWORD_POLICY.RECOMMENDED_LENGTH} ký
        tự trở lên. Một câu dài dễ nhớ là lựa chọn tốt; không bắt buộc chữ hoa hay ký tự đặc biệt.
      </p>
    );
  }

  const result = checkPassword(password);
  const level = !result.ok ? 1 : result.meetsRecommendation ? 3 : 2;
  let message;
  if (result.problems.includes('TOO_COMMON')) {
    message =
      'Mật khẩu này nằm trong danh sách mật khẩu phổ biến đã bị lộ. Hãy chọn mật khẩu khác.';
  } else if (result.problems.includes('TOO_SHORT')) {
    message = `Cần thêm ${PASSWORD_POLICY.MIN_LENGTH - result.length} ký tự nữa.`;
  } else if (level === 2) {
    message = `Đạt yêu cầu. Dài từ ${PASSWORD_POLICY.RECOMMENDED_LENGTH} ký tự sẽ an toàn hơn.`;
  } else {
    message = 'Mật khẩu mạnh.';
  }

  return (
    <div id={id} className={`strength strength-${level}`} aria-live="polite">
      <div className="strength-bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>
        <strong>{['', 'Chưa đạt', 'Đạt', 'Mạnh'][level]}.</strong> {message}
      </p>
    </div>
  );
}
