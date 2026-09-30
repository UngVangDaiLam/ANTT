import { useCallback, useEffect, useState } from 'react';
import { client } from './client.js';
import { formatWhen } from './lib/format.js';
import { Banner, useToast } from './components/Feedback.jsx';
import { Icon } from './components/Icon.jsx';
import { ConfirmDialog, Modal } from './components/Modal.jsx';

/**
 * Chia sẻ một ghi chú và quản lý những người đang có quyền.
 *
 * Tab "Chia sẻ mới" bắt đối chiếu fingerprint trước khi chia sẻ: nút chia sẻ chỉ bấm được sau khi
 * người dùng xác nhận đã đối chiếu — đó là lớp phòng vệ duy nhất trước việc máy chủ tráo khóa công
 * khai, nên không được là một ô tick cho có.
 *
 * Tab "Người có quyền" phân biệt hai cách gỡ quyền:
 *  - Thu hồi quyền (revokeAccess): đổi khóa ghi chú, người bị thu hồi không mở được nội dung mới
 *    kể cả nếu từng giữ khóa cũ. Được khuyên dùng.
 *  - Chỉ gỡ khỏi danh sách (unshareNote): máy chủ không cho đọc nữa, nhưng khóa không đổi (D53).
 */
export function ShareDialog({ noteId, noteTitle, onClose, onVersionChange, onError }) {
  const toast = useToast();
  const [tab, setTab] = useState('new');
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Chia sẻ mới
  const [email, setEmail] = useState('');
  const [fingerprint, setFingerprint] = useState(null);
  const [verified, setVerified] = useState(false);

  // Gỡ quyền: { kind: 'revoke' | 'unshare', share }
  const [pending, setPending] = useState(null);

  const fail = useCallback(
    (err, overrides = {}) => {
      const described = onError(err);
      if (described) setError(overrides[err?.code] ?? described);
    },
    [onError],
  );

  const loadPeople = useCallback(async () => {
    try {
      setPeople(await client.listNoteShares(noteId));
    } catch (err) {
      fail(err);
    }
  }, [noteId, fail]);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  function resetNewShare() {
    setEmail('');
    setFingerprint(null);
    setVerified(false);
  }

  async function lookup(event) {
    event.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target || busy) return;
    setError(null);
    if (target === client.currentUserEmail()) {
      setError({ tone: 'error', message: 'Bạn không thể chia sẻ ghi chú cho chính mình.' });
      return;
    }
    setBusy(true);
    try {
      setFingerprint(await client.getFingerprint(target));
      setVerified(false);
    } catch (err) {
      fail(err, {
        NOT_FOUND: { tone: 'error', message: 'Không tìm thấy tài khoản nào với email này.' },
      });
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!verified || !fingerprint || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Ràng buộc với đúng mã vừa đối chiếu: máy chủ đổi khóa giữa chừng thì SDK từ chối (D75).
      await client.shareNote(noteId, fingerprint.email, { verifiedFingerprint: fingerprint });
      toast(`Đã chia sẻ an toàn với ${fingerprint.email}.`);
      resetNewShare();
      await loadPeople();
      setTab('people');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    const { kind, share: target } = pending;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'revoke') {
        const result = await client.revokeAccess(noteId, [target.recipientEmail]);
        onVersionChange(result.version);
        toast(
          `Đã thu hồi quyền của ${target.recipientEmail}. Ghi chú đã được mã hóa lại bằng khóa mới.`,
        );
      } else {
        await client.unshareNote(target.id);
        toast(`Đã gỡ ${target.recipientEmail} khỏi danh sách chia sẻ.`);
      }
      setPending(null);
      await loadPeople();
    } catch (err) {
      setPending(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const alreadyShared = fingerprint && people?.some((p) => p.recipientEmail === fingerprint.email);

  return (
    <>
      <Modal title={`Chia sẻ “${noteTitle}”`} onClose={onClose} busy={busy} size="md">
        <div className="tabs" role="tablist" aria-label="Chia sẻ">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'new'}
            className={tab === 'new' ? 'active' : ''}
            onClick={() => setTab('new')}
          >
            Chia sẻ mới
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'people'}
            className={tab === 'people' ? 'active' : ''}
            onClick={() => setTab('people')}
          >
            Người có quyền{people ? ` (${people.length})` : ''}
          </button>
        </div>

        {error && <Banner tone={error.tone}>{error.message}</Banner>}

        {tab === 'new' && !fingerprint && (
          <form onSubmit={lookup} className="stack">
            <div className="field">
              <label htmlFor="share-email">Email người nhận</label>
              <input
                id="share-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ten@example.com"
                autoComplete="off"
                required
              />
              <p className="hint">Người nhận phải đã có tài khoản Secure Notes.</p>
            </div>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
                {busy && <span className="spinner" aria-hidden="true" />}
                Tiếp tục
              </button>
            </div>
          </form>
        )}

        {tab === 'new' && fingerprint && (
          <div className="stack">
            <p>
              Để chắc chắn khóa dưới đây đúng là của <strong>{fingerprint.email}</strong> chứ không
              phải khóa giả do máy chủ tráo vào, hãy đọc to mã này cho người nhận qua điện thoại
              hoặc gặp trực tiếp. Họ xem mã của chính mình ở mục <em>Mã xác minh của tôi</em>.
            </p>
            <div className="fingerprint">
              <span className="fingerprint-label">Mã khóa mã hóa (X25519)</span>
              <code>{fingerprint.x25519Fingerprint}</code>
              <span className="fingerprint-label">Mã khóa chữ ký (Ed25519)</span>
              <code>{fingerprint.ed25519Fingerprint}</code>
            </div>
            {alreadyShared && (
              <Banner tone="info">
                Ghi chú đã được chia sẻ với người này. Chia sẻ lại sẽ cấp cho họ một gói khóa mới.
              </Banner>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
              <span>Tôi đã đối chiếu và hai mã trên khớp với mã của người nhận.</span>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetNewShare}
                disabled={busy}
              >
                Quay lại
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={share}
                disabled={!verified || busy}
                title={verified ? undefined : 'Hãy đối chiếu mã và đánh dấu xác nhận trước'}
              >
                {busy && <span className="spinner" aria-hidden="true" />}
                Chia sẻ
              </button>
            </div>
          </div>
        )}

        {tab === 'people' && (
          <div className="stack">
            {people === null && <p className="muted">Đang tải…</p>}
            {people?.length === 0 && (
              <div className="empty-inline">
                <Icon name="users" size={28} />
                <p>Ghi chú này chưa được chia sẻ cho ai.</p>
              </div>
            )}
            {people?.length > 0 && (
              <ul className="people-list">
                {people.map((person) => (
                  <li key={person.id}>
                    <div className="avatar avatar-sm" aria-hidden="true">
                      {person.recipientEmail[0].toUpperCase()}
                    </div>
                    <div className="people-info">
                      <span className="people-email">{person.recipientEmail}</span>
                      <span className="muted">
                        Chia sẻ {formatWhen(person.createdAt).toLowerCase()}
                      </span>
                    </div>
                    <div className="people-actions">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => setPending({ kind: 'revoke', share: person })}
                        disabled={busy}
                      >
                        Thu hồi quyền
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setPending({ kind: 'unshare', share: person })}
                        disabled={busy}
                      >
                        Chỉ gỡ khỏi danh sách
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      {pending && (
        <ConfirmDialog
          title={pending.kind === 'revoke' ? 'Thu hồi quyền truy cập?' : 'Chỉ gỡ khỏi danh sách?'}
          confirmLabel={pending.kind === 'revoke' ? 'Thu hồi quyền' : 'Gỡ khỏi danh sách'}
          tone="danger"
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={confirmRemoval}
        >
          {pending.kind === 'revoke' ? (
            <p>
              <strong>{pending.share.recipientEmail}</strong> sẽ không mở được ghi chú này nữa. Ghi
              chú được mã hóa lại bằng khóa mới, nên kể cả khóa cũ họ từng có cũng không mở được nội
              dung từ giờ về sau. Những gì họ đã đọc trước đó thì không thể lấy lại.
            </p>
          ) : (
            <p>
              Máy chủ sẽ không cho <strong>{pending.share.recipientEmail}</strong> đọc ghi chú này
              nữa, nhưng khóa <strong>không</strong> được đổi. Nếu cần chắc chắn họ không đọc được
              nữa, hãy dùng <em>Thu hồi quyền</em>.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
