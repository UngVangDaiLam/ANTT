import { useState } from 'react';
import { checkPassword } from '@secure-notes/client-sdk';
import { client } from './client.js';
import { describeError } from './lib/errors.js';
import { Banner, useToast } from './components/Feedback.jsx';
import { Modal } from './components/Modal.jsx';
import { PasswordField, PasswordStrength } from './components/PasswordField.jsx';

/**
 * Đổi mật khẩu. Không mã hóa lại ghi chú nào — chỉ bọc lại khóa, nên nhanh dù có bao nhiêu ghi chú.
 * Server hủy mọi phiên khác (D25), nên báo rõ cho người dùng biết các thiết bị khác sẽ bị đăng xuất.
 */
export function ChangePasswordDialog({ onClose, onSessionExpired }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const strength = checkPassword(next);
  const sameAsCurrent = next.length > 0 && next === current;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = !busy && current && strength.ok && !sameAsCurrent && confirm === next;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await client.changePassword(current, next);
      toast('Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.');
      onClose();
    } catch (err) {
      const described = describeError(err);
      if (described.tone === 'session') {
        onSessionExpired(described.message);
        return;
      }
      setError(
        err?.code === 'INVALID_CREDENTIALS'
          ? { tone: 'error', message: 'Mật khẩu hiện tại không đúng.' }
          : described,
      );
      setBusy(false);
    }
  }

  return (
    <Modal title="Đổi mật khẩu" onClose={onClose} busy={busy} size="sm">
      <form onSubmit={handleSubmit} noValidate>
        {error && <Banner tone={error.tone}>{error.message}</Banner>}
        <PasswordField
          label="Mật khẩu hiện tại"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <PasswordField
          label="Mật khẩu mới"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          describedBy="new-password-strength"
        />
        {sameAsCurrent ? (
          <p id="new-password-strength" className="hint hint-error">
            Mật khẩu mới phải khác mật khẩu hiện tại.
          </p>
        ) : (
          <PasswordStrength password={next} id="new-password-strength" />
        )}
        <PasswordField
          label="Nhập lại mật khẩu mới"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        {mismatch && <p className="hint hint-error">Hai mật khẩu chưa khớp.</p>}
        <p className="hint">Sau khi đổi, các thiết bị khác đang đăng nhập sẽ bị đăng xuất.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? 'Đang tạo khóa mới…' : 'Đổi mật khẩu'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
