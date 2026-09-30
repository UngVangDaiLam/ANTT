import { useState } from 'react';
import { client } from './client.js';
import { Banner } from './components/Feedback.jsx';
import { PasswordField } from './components/PasswordField.jsx';

/**
 * Xóa vĩnh viễn tài khoản (ASVS 7.4.2, D86). Hai lớp chống bấm nhầm: gõ lại đúng email của mình, và
 * nhập mật khẩu (máy chủ kiểm tra lại, người mượn máy đang đăng nhập không làm được).
 */
export function DeleteAccountPanel({ email, onDeleted, onError }) {
  const [typedEmail, setTypedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const emailMatches = typedEmail.trim().toLowerCase() === email;
  const canSubmit = emailMatches && password && !busy;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await client.deleteAccount(password);
      onDeleted();
    } catch (err) {
      setBusy(false);
      if (err?.code === 'INVALID_CREDENTIALS') {
        setError({ tone: 'error', message: 'Mật khẩu không đúng.' });
      } else {
        const described = onError(err);
        if (described) setError(described);
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="stack">
      <Banner tone="warning" title="Không thể hoàn tác">
        <ul className="consequences">
          <li>Mọi ghi chú của bạn bị xóa vĩnh viễn.</li>
          <li>Những người bạn đã chia sẻ không còn đọc được các ghi chú đó.</li>
          <li>Các ghi chú người khác chia sẻ cho bạn bị gỡ khỏi tài khoản.</li>
          <li>Mọi thiết bị bị đăng xuất; lịch sử đăng nhập bị xóa.</li>
        </ul>
        Vì ghi chú được mã hóa đầu cuối, không ai (kể cả quản trị máy chủ) khôi phục được.
      </Banner>
      {error && <Banner tone={error.tone}>{error.message}</Banner>}
      <div className="field">
        <label htmlFor="delete-confirm-email">
          Gõ <strong>{email}</strong> để xác nhận
        </label>
        <input
          id="delete-confirm-email"
          type="email"
          value={typedEmail}
          onChange={(event) => setTypedEmail(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <PasswordField
        label="Mật khẩu hiện tại"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      <div className="modal-actions">
        <button type="submit" className="btn btn-danger" disabled={!canSubmit}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? 'Đang xóa…' : 'Xóa vĩnh viễn tài khoản'}
        </button>
      </div>
    </form>
  );
}
