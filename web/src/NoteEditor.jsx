import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from './client.js';
import { displayTitle, formatWhen } from './lib/format.js';
import { Banner, useToast } from './components/Feedback.jsx';
import { Icon } from './components/Icon.jsx';
import { ConfirmDialog } from './components/Modal.jsx';
import { ShareDialog } from './ShareDialog.jsx';

/**
 * Xem và sửa một ghi chú.
 *
 * - Lưu bằng nút hoặc Ctrl/Cmd+S; trạng thái "Đã lưu / Chưa lưu / Đang lưu" luôn hiện rõ.
 * - Luôn gửi đúng version của bản ĐANG SỬA (D61). Nếu thiết bị khác đã lưu trước, hiện lựa chọn
 *   rõ ràng: sao chép bản của mình rồi tải bản mới nhất — không âm thầm ghi đè, không âm thầm mất chữ.
 * - Ghi chú được chia sẻ cho mình: chỉ xem, ô nhập ở chế độ đọc (vẫn chọn/sao chép chữ được).
 */
export function NoteEditor({ noteId, focusTitle, onSaved, onDeleted, onDirtyChange, onError }) {
  const toast = useToast();
  const [base, setBase] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const titleRef = useRef(null);

  const readOnly = Boolean(base?.sharedBy);
  const dirty = base !== null && !readOnly && (title !== base.title || content !== base.content);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const loaded = await client.readNote(noteId);
      setBase(loaded);
      setTitle(loaded.title);
      setContent(loaded.content);
      setConflict(false);
      setSaveError(null);
    } catch (err) {
      const described = onError(err);
      if (described) setLoadError(described);
    }
  }, [noteId, onError]);

  useEffect(() => {
    load();
  }, [load]);

  // Ghi chú mới tạo: đặt con trỏ vào tiêu đề và chọn sẵn chữ để gõ đè ngay — ĐÚNG MỘT LẦN khi vừa
  // mở. Nếu chạy lại sau mỗi lần lưu hay tải lại, tiêu đề bị bôi đen và người dùng gõ tiếp sẽ xóa mất.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusTitle && base && !readOnly && !focusedOnce.current) {
      focusedOnce.current = true;
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [focusTitle, base, readOnly]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // Đóng tab khi còn thay đổi chưa lưu: trình duyệt hỏi lại.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!dirty || saving || conflict) return;
    // Chụp lại đúng nội dung đang gửi: người dùng có thể gõ tiếp trong lúc chờ.
    const draft = { title, content };
    setSaving(true);
    setSaveError(null);
    try {
      const result = await client.updateNote(noteId, { ...draft, version: base.version });
      setBase((previous) => ({
        ...previous,
        ...draft,
        version: result.version,
        updatedAt: result.updatedAt,
      }));
      toast('Đã lưu ghi chú.');
      onSaved();
    } catch (err) {
      if (err?.code === 'VERSION_CONFLICT') {
        setConflict(true);
      } else {
        const described = onError(err);
        if (described) setSaveError(described);
      }
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, conflict, title, content, noteId, base, toast, onSaved, onError]);

  const saveRef = useRef(save);
  const dialogOpen = shareOpen || confirmDelete;
  const dialogOpenRef = useRef(dialogOpen);
  useEffect(() => {
    saveRef.current = save;
    dialogOpenRef.current = dialogOpen;
  }, [save, dialogOpen]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        // Đang mở hộp thoại (chia sẻ, xóa) thì không lưu ngầm phía sau: lưu xen giữa lúc thu hồi
        // quyền sẽ làm lệch version.
        if (!dialogOpenRef.current) saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function copyMine() {
    try {
      await navigator.clipboard.writeText(`${title}\n\n${content}`);
      toast('Đã sao chép bản của bạn vào bộ nhớ tạm.');
    } catch {
      toast('Không sao chép được. Hãy chọn và sao chép thủ công.', 'error');
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await client.deleteNote(noteId);
      toast('Đã xóa ghi chú.');
      onDeleted();
    } catch (err) {
      setConfirmDelete(false);
      setDeleting(false);
      const described = onError(err);
      if (described) setSaveError(described);
    }
  }

  if (loadError) {
    return (
      <section className="editor editor-state">
        <Banner
          tone={loadError.tone}
          title={
            loadError.tone === 'security'
              ? 'Đã chặn dữ liệu không an toàn'
              : 'Không mở được ghi chú'
          }
          actions={
            <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
              <Icon name="refresh" size={16} /> Thử lại
            </button>
          }
        >
          {loadError.message}
        </Banner>
      </section>
    );
  }

  if (!base) {
    return (
      <section className="editor editor-state" aria-busy="true">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line short" />
        <span className="visually-hidden">Đang giải mã ghi chú…</span>
      </section>
    );
  }

  let status;
  if (saving) status = { tone: 'busy', text: 'Đang lưu…' };
  else if (dirty) status = { tone: 'dirty', text: 'Chưa lưu' };
  else status = { tone: 'saved', text: `Đã lưu · ${formatWhen(base.updatedAt)}` };

  return (
    <section className="editor" aria-label="Soạn thảo ghi chú">
      <div className="editor-toolbar">
        {readOnly ? (
          <span className="status-pill status-readonly">
            <Icon name="eye" size={14} /> Chỉ xem
          </span>
        ) : (
          <span className={`status-pill status-${status.tone}`} aria-live="polite">
            {status.tone === 'saved' && <Icon name="check" size={14} />}
            {status.text}
          </span>
        )}
        {!readOnly && (
          <div className="toolbar-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setShareOpen(true)}>
              <Icon name="share" size={16} /> Chia sẻ
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={!dirty || saving || conflict}
              title="Lưu (Ctrl+S)"
            >
              {saving ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Icon name="check" size={16} />
              )}
              Lưu
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              onClick={() => setConfirmDelete(true)}
              aria-label="Xóa ghi chú"
              title="Xóa ghi chú"
            >
              <Icon name="trash" />
            </button>
          </div>
        )}
      </div>

      {readOnly && (
        <Banner tone="info">
          Được chia sẻ bởi <strong>{base.sharedBy}</strong>. Bạn chỉ có thể xem, không thể sửa hay
          chia sẻ tiếp ghi chú này.
        </Banner>
      )}

      {conflict && (
        <Banner
          tone="warning"
          title="Ghi chú vừa được sửa ở nơi khác"
          actions={
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={copyMine}>
                <Icon name="copy" size={16} /> Sao chép bản của tôi
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={load}>
                <Icon name="refresh" size={16} /> Tải bản mới nhất
              </button>
            </>
          }
        >
          Bản của bạn chưa được lưu để không ghi đè lên thay đổi kia. Hãy sao chép bản của bạn
          trước, rồi tải bản mới nhất và thêm lại những gì cần.
        </Banner>
      )}

      {saveError && <Banner tone={saveError.tone}>{saveError.message}</Banner>}

      <div className="editor-body">
        <input
          ref={titleRef}
          className="editor-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Tiêu đề"
          aria-label="Tiêu đề ghi chú"
          readOnly={readOnly}
          // 300 ký tự x tối đa 3 byte (tiếng Việt có dấu) luôn dưới trần 1024 byte của tiêu đề.
          maxLength={300}
        />
        <textarea
          className="editor-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={readOnly ? '' : 'Viết ghi chú của bạn ở đây…'}
          aria-label="Nội dung ghi chú"
          readOnly={readOnly}
        />
      </div>

      <footer className="editor-footer">
        <span>
          <Icon name="lock" size={14} /> Mã hóa đầu cuối
        </span>
        <span>{[...content].length.toLocaleString('vi-VN')} ký tự</span>
      </footer>

      {shareOpen && (
        <ShareDialog
          noteId={noteId}
          noteTitle={displayTitle(base.title)}
          onClose={() => setShareOpen(false)}
          onVersionChange={(version) => {
            // Thu hồi quyền xoay khóa trên bản MỚI NHẤT ở máy chủ. Chỉ khi bản đó đúng là bản
            // đang mở thì mới được nhận version mới; nếu không, thiết bị khác đã lưu xen giữa và
            // nhận version mới sẽ khiến lần lưu sau âm thầm đè lên thay đổi kia.
            if (version === base.version + 1) {
              setBase((previous) => ({ ...previous, version }));
            } else if (dirty) {
              setConflict(true);
            } else {
              load();
            }
          }}
          onError={onError}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Xóa ghi chú này?"
          confirmLabel="Xóa vĩnh viễn"
          tone="danger"
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        >
          <p>
            <strong>{displayTitle(base.title)}</strong> sẽ bị xóa vĩnh viễn, kể cả với những người
            đang được chia sẻ. Không thể hoàn tác.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
