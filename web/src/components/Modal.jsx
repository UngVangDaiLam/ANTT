import { useEffect, useId, useRef } from 'react';
import { Icon } from './Icon.jsx';

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]):not([data-modal-close]), [tabindex]:not([tabindex="-1"])';

/**
 * Hộp thoại dùng chung, dễ dùng bằng bàn phím và trình đọc màn hình:
 * - `role="dialog"` + `aria-modal`, tiêu đề gắn qua `aria-labelledby`;
 * - mở ra thì đưa focus vào ô/nút đầu tiên, đóng thì trả focus về chỗ cũ;
 * - Esc hoặc bấm ra ngoài để đóng — trừ khi đang xử lý (`busy`), để không bỏ dở giữa chừng.
 */
export function Modal({ title, onClose, busy = false, size = 'md', children, footer }) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    const first = panelRef.current?.querySelector(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            data-modal-close
            onClick={onClose}
            disabled={busy}
            aria-label="Đóng"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * Hộp thoại xác nhận. Nút "Hủy" nhận focus đầu tiên: bấm Enter theo quán tính không kích hoạt
 * hành động nguy hiểm.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  tone = 'primary',
  busy,
  onConfirm,
  onCancel,
  children,
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      busy={busy}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Hủy
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
