import { useCallback, useEffect, useState } from 'react';
import { client } from './client.js';
import { describeDevice, formatDateTime, formatWhen } from './lib/format.js';
import { Banner, useToast } from './components/Feedback.jsx';
import { Icon } from './components/Icon.jsx';
import { Modal } from './components/Modal.jsx';
import { PasswordField } from './components/PasswordField.jsx';
import { DeleteAccountPanel } from './DeleteAccountPanel.jsx';

/** Nhãn cho từng dòng lịch sử theo `kind` và kết quả. */
const HISTORY_LABELS = {
  login: ['Đăng nhập thành công', 'Đăng nhập sai mật khẩu'],
  change_password: ['Đổi mật khẩu', 'Đổi mật khẩu: sai mật khẩu hiện tại'],
  revoke_sessions: [
    'Xác nhận mật khẩu để đăng xuất thiết bị khác',
    'Đăng xuất thiết bị khác: sai mật khẩu',
  ],
};

function historyLabel(entry) {
  const [ok, failed] = HISTORY_LABELS[entry.kind] ?? HISTORY_LABELS.login;
  return entry.success ? ok : failed;
}

/**
 * Tài khoản và bảo mật: thiết bị đang đăng nhập, lịch sử đăng nhập (ASVS 7.5.2, 16.3.1) và xóa tài
 * khoản (7.4.2).
 *
 * Đăng xuất thiết bị khác phải nhập lại mật khẩu: người mượn được máy đang đăng nhập không đá được
 * chủ tài khoản ra khỏi các thiết bị khác. Lịch sử có cả lần sai mật khẩu, để người dùng nhận ra có
 * ai đang đoán mật khẩu của mình.
 */
export function SessionsDialog({ email, onClose, onError, onChangePassword, onAccountDeleted }) {
  const [tab, setTab] = useState('devices');
  const [sessions, setSessions] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  // { sessionId?: string, label: string } — thiết bị cần đăng xuất, chờ nhập mật khẩu
  const [pending, setPending] = useState(null);

  const fail = useCallback(
    (err) => {
      const described = onError(err);
      if (described) setError(described);
    },
    [onError],
  );

  const loadSessions = useCallback(async () => {
    try {
      const list = await client.listSessions();
      // Thiết bị đang dùng luôn đứng đầu; còn lại giữ thứ tự hoạt động gần nhất từ máy chủ.
      setSessions([...list.filter((s) => s.current), ...list.filter((s) => !s.current)]);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await client.loginHistory());
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    loadSessions();
    loadHistory();
  }, [loadSessions, loadHistory]);

  const others = sessions?.filter((s) => !s.current) ?? [];
  const failures = history?.filter((entry) => !entry.success) ?? [];

  return (
    <>
      <Modal title="Tài khoản và bảo mật" onClose={onClose} size="md">
        <div className="tabs" role="tablist" aria-label="Bảo mật tài khoản">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'devices'}
            className={tab === 'devices' ? 'active' : ''}
            onClick={() => setTab('devices')}
          >
            Thiết bị{sessions ? ` (${sessions.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={tab === 'history' ? 'active' : ''}
            onClick={() => setTab('history')}
          >
            Lịch sử
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'delete'}
            className={`tab-danger ${tab === 'delete' ? 'active' : ''}`}
            onClick={() => setTab('delete')}
          >
            Xóa tài khoản
          </button>
        </div>

        {error && <Banner tone={error.tone}>{error.message}</Banner>}

        {tab === 'devices' && (
          <div className="stack">
            {sessions === null && !error && <p className="muted">Đang tải…</p>}
            {sessions && (
              <ul className="people-list">
                {sessions.map((session) => (
                  <li key={session.id} className={session.current ? 'is-current' : ''}>
                    <div className="device-icon" aria-hidden="true">
                      <Icon name="device" size={18} />
                    </div>
                    <div className="people-info">
                      <span className="people-email">
                        {describeDevice(session.userAgent)}
                        {session.current && <span className="badge">Thiết bị này</span>}
                      </span>
                      <span className="muted">
                        Hoạt động {formatWhen(session.lastSeenAt).toLowerCase()}
                        {session.ip && ` · IP ${session.ip}`}
                      </span>
                      <span className="muted">
                        Đăng nhập {formatDateTime(session.createdAt).toLowerCase()}
                      </span>
                    </div>
                    {!session.current && (
                      <div className="people-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            setPending({
                              sessionId: session.id,
                              label: describeDevice(session.userAgent),
                            })
                          }
                        >
                          Đăng xuất
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {sessions && others.length === 0 && (
              <p className="hint">Tài khoản chỉ đang đăng nhập trên thiết bị này.</p>
            )}
            {others.length > 1 && (
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setPending({ label: `${others.length} thiết bị khác` })}
                >
                  <Icon name="logout" size={16} /> Đăng xuất mọi thiết bị khác
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'delete' && (
          <DeleteAccountPanel email={email} onDeleted={onAccountDeleted} onError={onError} />
        )}

        {tab === 'history' && (
          <div className="stack">
            {history === null && !error && <p className="muted">Đang tải…</p>}
            {failures.length > 0 && (
              <Banner
                tone="warning"
                title={`${failures.length} lần nhập sai mật khẩu gần đây`}
                actions={
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onChangePassword}
                  >
                    <Icon name="key" size={16} /> Đổi mật khẩu
                  </button>
                }
              >
                Nếu không phải bạn gõ nhầm, có thể ai đó đang đoán mật khẩu. Sau vài lần sai, máy
                chủ bắt phải chờ lâu dần trước khi được thử tiếp. Hãy đổi sang một mật khẩu dài và
                chưa dùng ở nơi khác.
              </Banner>
            )}
            {history?.length === 0 && <p className="muted">Chưa có lần đăng nhập nào.</p>}
            {history && history.length > 0 && (
              <ul className="history-list">
                {history.map((entry) => (
                  <li key={entry.id} className={entry.success ? '' : 'is-failed'}>
                    <Icon name={entry.success ? 'check' : 'alert'} size={16} />
                    <div className="people-info">
                      <span className="history-title">{historyLabel(entry)}</span>
                      <span className="muted">
                        {formatDateTime(entry.createdAt)} · {describeDevice(entry.userAgent)}
                        {entry.ip && ` · IP ${entry.ip}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      {pending && (
        <ReauthDialog
          pending={pending}
          onCancel={() => setPending(null)}
          onDone={() => {
            setPending(null);
            loadSessions();
          }}
          onError={onError}
        />
      )}
    </>
  );
}

/** Nhập lại mật khẩu trước khi đăng xuất thiết bị khác (ASVS 7.5.2). */
function ReauthDialog({ pending, onCancel, onDone, onError }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { revoked } = await client.revokeSessions(password, pending.sessionId);
      toast(revoked === 1 ? 'Đã đăng xuất thiết bị.' : `Đã đăng xuất ${revoked} thiết bị.`);
      onDone();
    } catch (err) {
      setBusy(false);
      if (err?.code === 'INVALID_CREDENTIALS') {
        setError({ tone: 'error', message: 'Mật khẩu không đúng.' });
      } else if (err?.code === 'NOT_FOUND') {
        // Thiết bị đó đã tự đăng xuất hoặc hết hạn trong lúc chờ: kết quả vẫn là điều người dùng muốn.
        toast('Thiết bị đó đã không còn đăng nhập.', 'info');
        onDone();
      } else {
        const described = onError(err);
        if (described) setError(described);
      }
    }
  }

  return (
    <Modal title="Xác nhận bằng mật khẩu" onClose={onCancel} busy={busy} size="sm">
      <form onSubmit={handleSubmit} noValidate className="stack">
        <p>
          Nhập mật khẩu hiện tại để đăng xuất <strong>{pending.label}</strong>. Thiết bị đó sẽ phải
          đăng nhập lại.
        </p>
        {error && <Banner tone={error.tone}>{error.message}</Banner>}
        <PasswordField
          label="Mật khẩu hiện tại"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Hủy
          </button>
          <button type="submit" className="btn btn-danger" disabled={!password || busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? 'Đang kiểm tra mật khẩu…' : 'Đăng xuất'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
