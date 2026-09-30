import { useState } from 'react';
import { checkPassword } from '@secure-notes/client-sdk';
import { client } from './client.js';
import { describeError } from './lib/errors.js';
import { Banner } from './components/Feedback.jsx';
import { Icon } from './components/Icon.jsx';
import { PasswordField, PasswordStrength } from './components/PasswordField.jsx';

const FEATURES = [
  [
    'lock',
    'Mã hóa ngay trên trình duyệt',
    'Máy chủ chỉ giữ dữ liệu đã mã hóa, không đọc được ghi chú của bạn.',
  ],
  ['share', 'Chia sẻ an toàn', 'Mỗi ghi chú một khóa riêng; thu hồi quyền là đổi khóa thật sự.'],
  [
    'shieldCheck',
    'Chống máy chủ gian lận',
    'Dữ liệu bị sửa hay bị tráo đều bị phát hiện và từ chối.',
  ],
];

/**
 * Màn hình đăng nhập / đăng ký.
 * @param {{ notice: { tone: string, text: string } | null, onSignedIn: (email: string) => void }} props
 */
export function AuthForm({ notice, onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isRegister = mode === 'register';
  const strength = isRegister ? checkPassword(password) : null;
  const mismatch = isRegister && confirm.length > 0 && confirm !== password;
  const canSubmit =
    !busy && email.trim() && password && (!isRegister || (strength.ok && confirm === password));

  function switchMode(next) {
    if (busy || next === mode) return;
    setMode(next);
    setError(null);
    setConfirm('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = isRegister
        ? await client.register(email, password)
        : await client.login(email, password);
      onSignedIn(result.email);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-hero" aria-hidden="true">
        <div className="brand brand-light">
          <Icon name="drop" size={28} className="brand-mark" />
          <span>Secure Notes</span>
        </div>
        <h1>Ghi chú của bạn, chỉ bạn đọc được.</h1>
        <ul className="feature-list">
          {FEATURES.map(([icon, title, text]) => (
            <li key={title}>
              <Icon name={icon} size={22} />
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <main className="auth-panel">
        <div className="auth-card">
          <div className="brand brand-compact">
            <Icon name="drop" size={24} className="brand-mark" />
            <span>Secure Notes</span>
          </div>

          <div className="segmented" role="tablist" aria-label="Chọn đăng nhập hoặc đăng ký">
            {[
              ['login', 'Đăng nhập'],
              ['register', 'Đăng ký'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                className={mode === value ? 'active' : ''}
                onClick={() => switchMode(value)}
                disabled={busy}
              >
                {label}
              </button>
            ))}
          </div>

          <h2 className="auth-title">{isRegister ? 'Tạo tài khoản mới' : 'Chào mừng trở lại'}</h2>

          {notice && !error && <Banner tone={notice.tone}>{notice.text}</Banner>}
          {error && <Banner tone={error.tone}>{error.message}</Banner>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
            </div>

            <PasswordField
              label="Mật khẩu"
              value={password}
              onChange={setPassword}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              describedBy={isRegister ? 'auth-strength' : undefined}
            />
            {isRegister && <PasswordStrength password={password} id="auth-strength" />}

            {isRegister && (
              <>
                <PasswordField
                  label="Nhập lại mật khẩu"
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                  describedBy="auth-confirm-hint"
                />
                <p id="auth-confirm-hint" className={mismatch ? 'hint hint-error' : 'hint'}>
                  {mismatch ? 'Hai mật khẩu chưa khớp.' : 'Nhập lại để tránh gõ nhầm.'}
                </p>
                <Banner tone="warning" title="Không thể lấy lại mật khẩu">
                  Máy chủ không biết mật khẩu của bạn. Nếu quên, toàn bộ ghi chú sẽ không mở được
                  nữa. Hãy ghi nhớ hoặc lưu vào trình quản lý mật khẩu.
                </Banner>
              </>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-block btn-lg"
              disabled={!canSubmit}
            >
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy
                ? isRegister
                  ? 'Đang tạo khóa bảo mật…'
                  : 'Đang mở khóa…'
                : isRegister
                  ? 'Tạo tài khoản'
                  : 'Đăng nhập'}
            </button>
          </form>

          <p className="auth-switch">
            {isRegister ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? '}
            <button
              type="button"
              className="link-btn"
              onClick={() => switchMode(isRegister ? 'login' : 'register')}
              disabled={busy}
            >
              {isRegister ? 'Đăng nhập' : 'Đăng ký ngay'}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
