import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { client } from './client.js';
import { describeError } from './lib/errors.js';
import { displayTitle, formatWhen } from './lib/format.js';
import { Banner, useToast } from './components/Feedback.jsx';
import { Icon } from './components/Icon.jsx';
import { ConfirmDialog, Modal } from './components/Modal.jsx';
import { ThemeToggle } from './components/ThemeToggle.jsx';
import { NoteEditor } from './NoteEditor.jsx';
import { ChangePasswordDialog } from './ChangePasswordDialog.jsx';
import { SessionsDialog } from './SessionsDialog.jsx';

/**
 * Khung làm việc sau khi đăng nhập: thanh bên (tạo, tìm, danh sách ghi chú, tài khoản) và vùng
 * soạn thảo. Trên màn hình hẹp, thanh bên thu thành ngăn kéo mở bằng nút menu.
 */
export function Dashboard({ email, onSignOut, onAccountDeleted }) {
  const toast = useToast();
  const [notes, setNotes] = useState([]);
  const [shared, setShared] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState(null);
  const [selected, setSelected] = useState(null); // { id, isNew }
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [dialog, setDialog] = useState(null); // 'password' | 'fingerprint' | 'sessions'
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Request gửi đi khi Dashboard còn mở có thể trả về SAU khi nó đã đóng (đăng xuất, đổi tài khoản).
  // Kết quả muộn đó thuộc về phiên cũ: bỏ qua, nếu không một lỗi 401 muộn sẽ đăng xuất nhầm phiên mới.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Hết phiên thì về màn hình đăng nhập; lỗi khác trả về để nơi gọi hiển thị. */
  const handleError = useCallback(
    (err) => {
      if (!alive.current) return null;
      const described = describeError(err);
      if (described.tone === 'session') {
        onSignOut({ tone: 'session', text: described.message });
        return null;
      }
      return described;
    },
    [onSignOut],
  );

  const refresh = useCallback(async () => {
    try {
      const [mine, withMe] = await Promise.all([client.listNotes(), client.listSharedWithMe()]);
      if (!alive.current) return;
      setNotes(mine);
      setShared(withMe);
      setListError(null);
    } catch (err) {
      const described = handleError(err);
      if (described) setListError(described);
    } finally {
      setLoaded(true);
    }
  }, [handleError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Mọi thao tác rời khỏi ghi chú đang sửa dở đều hỏi lại trước. */
  const guard = useCallback(
    (action) => {
      if (dirty) setPendingAction(() => action);
      else action();
    },
    [dirty],
  );

  function open(id) {
    guard(() => {
      setSelected({ id, isNew: false });
      setDrawerOpen(false);
    });
  }

  function createNote() {
    guard(async () => {
      setCreating(true);
      try {
        const created = await client.createNote({ title: 'Ghi chú không tên', content: '' });
        await refresh();
        setSelected({ id: created.id, isNew: true });
        setDrawerOpen(false);
      } catch (err) {
        const described = handleError(err);
        if (described) toast(described.message, described.tone);
      } finally {
        setCreating(false);
      }
    });
  }

  const needle = query.trim().toLowerCase();
  const visibleNotes = useMemo(
    () => notes.filter((n) => !needle || displayTitle(n.title).toLowerCase().includes(needle)),
    [notes, needle],
  );
  const visibleShared = useMemo(
    () => shared.filter((s) => !needle || s.senderEmail.includes(needle)),
    [shared, needle],
  );

  return (
    <div className={`app-shell ${drawerOpen ? 'drawer-open' : ''}`}>
      <aside className="sidebar" aria-label="Điều hướng">
        <div className="sidebar-top">
          <div className="brand">
            <Icon name="drop" size={24} className="brand-mark" />
            <span>Secure Notes</span>
          </div>
          <ThemeToggle className="sidebar-theme" />
          <button
            type="button"
            className="icon-btn sidebar-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Đóng danh sách"
          >
            <Icon name="close" />
          </button>
        </div>

        <button
          type="button"
          className="btn btn-accent btn-block"
          onClick={createNote}
          disabled={creating}
        >
          {creating ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" />}
          Ghi chú mới
        </button>

        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm ghi chú…"
            aria-label="Tìm theo tiêu đề hoặc người chia sẻ"
          />
        </label>

        <nav className="note-nav" aria-label="Danh sách ghi chú">
          <h3 className="nav-heading">
            Ghi chú của tôi {loaded && <span className="count">{notes.length}</span>}
          </h3>
          {!loaded && <p className="nav-empty">Đang giải mã…</p>}
          {loaded && visibleNotes.length === 0 && (
            <p className="nav-empty">
              {needle ? 'Không có ghi chú nào khớp.' : 'Chưa có ghi chú nào.'}
            </p>
          )}
          <ul>
            {visibleNotes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className={`nav-item ${selected?.id === note.id ? 'active' : ''}`}
                  aria-current={selected?.id === note.id ? 'true' : undefined}
                  onClick={() => open(note.id)}
                >
                  <span className="nav-title">{displayTitle(note.title)}</span>
                  <span className="nav-meta">{formatWhen(note.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>

          {shared.length > 0 && (
            <>
              <h3 className="nav-heading">
                Được chia sẻ với tôi <span className="count">{shared.length}</span>
              </h3>
              <ul>
                {visibleShared.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`nav-item ${selected?.id === item.noteId ? 'active' : ''}`}
                      aria-current={selected?.id === item.noteId ? 'true' : undefined}
                      onClick={() => open(item.noteId)}
                    >
                      <span className="nav-title">
                        <Icon name="users" size={14} /> Từ {item.senderEmail}
                      </span>
                      <span className="nav-meta">{formatWhen(item.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="avatar" aria-hidden="true">
            {email[0].toUpperCase()}
          </div>
          <span className="who" title={email}>
            {email}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDialog('fingerprint')}
            aria-label="Mã xác minh của tôi"
            title="Mã xác minh của tôi"
          >
            <Icon name="shieldCheck" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDialog('sessions')}
            aria-label="Tài khoản và bảo mật"
            title="Tài khoản và bảo mật"
          >
            <Icon name="device" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDialog('password')}
            aria-label="Đổi mật khẩu"
            title="Đổi mật khẩu"
          >
            <Icon name="key" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => guard(() => onSignOut(null))}
            aria-label="Đăng xuất"
            title="Đăng xuất"
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />

      <main className="workspace">
        <header className="mobile-bar">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Mở danh sách ghi chú"
          >
            <Icon name="menu" />
          </button>
          <div className="brand">
            <Icon name="drop" size={20} className="brand-mark" />
            <span>Secure Notes</span>
          </div>
        </header>

        {listError && (
          <Banner
            tone={listError.tone}
            actions={
              <button type="button" className="btn btn-secondary btn-sm" onClick={refresh}>
                <Icon name="refresh" size={16} /> Thử lại
              </button>
            }
          >
            {listError.message}
          </Banner>
        )}

        {selected ? (
          <NoteEditor
            key={selected.id}
            noteId={selected.id}
            focusTitle={selected.isNew}
            onSaved={refresh}
            onDeleted={() => {
              setDirty(false);
              setSelected(null);
              refresh();
            }}
            onDirtyChange={setDirty}
            onError={handleError}
          />
        ) : (
          <section className="empty-state">
            <div className="empty-icon" aria-hidden="true">
              <Icon name="note" size={40} />
            </div>
            <h2>{notes.length ? 'Chọn một ghi chú để mở' : 'Bắt đầu ghi chú đầu tiên'}</h2>
            <p>
              Mọi thứ bạn viết được mã hóa ngay trên trình duyệt trước khi gửi đi. Máy chủ chỉ lưu
              bản đã mã hóa và không đọc được nội dung.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={createNote}
              disabled={creating}
            >
              <Icon name="plus" /> Ghi chú mới
            </button>
          </section>
        )}
      </main>

      {dialog === 'password' && (
        <ChangePasswordDialog
          onClose={() => setDialog(null)}
          onSessionExpired={(text) => onSignOut({ tone: 'session', text })}
        />
      )}

      {dialog === 'fingerprint' && <MyFingerprintDialog onClose={() => setDialog(null)} />}

      {dialog === 'sessions' && (
        <SessionsDialog
          email={email}
          onAccountDeleted={onAccountDeleted}
          onClose={() => setDialog(null)}
          onError={handleError}
          onChangePassword={() => setDialog('password')}
        />
      )}

      {pendingAction && (
        <ConfirmDialog
          title="Bỏ thay đổi chưa lưu?"
          confirmLabel="Bỏ thay đổi"
          tone="danger"
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            const action = pendingAction;
            setPendingAction(null);
            setDirty(false);
            action();
          }}
        >
          <p>Ghi chú đang mở còn thay đổi chưa lưu. Nếu tiếp tục, những thay đổi đó sẽ mất.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * Mã xác minh của chính mình, tính từ khóa trong trình duyệt (không hỏi máy chủ). Người nhận đọc mã
 * này cho người muốn chia sẻ với mình đối chiếu.
 */
function MyFingerprintDialog({ onClose }) {
  const mine = client.myFingerprint();
  return (
    <Modal
      title="Mã xác minh của tôi"
      onClose={onClose}
      size="sm"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Đóng
        </button>
      }
    >
      <p>
        Khi ai đó muốn chia sẻ ghi chú với bạn, họ sẽ thấy hai mã dưới đây. Hãy đọc cho họ đối chiếu
        qua điện thoại hoặc gặp trực tiếp. Mã được tính ngay trên máy bạn, không lấy từ máy chủ.
      </p>
      <div className="fingerprint">
        <span className="fingerprint-label">Mã khóa mã hóa (X25519)</span>
        <code>{mine.x25519Fingerprint}</code>
        <span className="fingerprint-label">Mã khóa chữ ký (Ed25519)</span>
        <code>{mine.ed25519Fingerprint}</code>
      </div>
    </Modal>
  );
}
