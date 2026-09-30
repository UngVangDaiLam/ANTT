import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

const TONE_ICON = {
  success: 'check',
  info: 'shieldCheck',
  warning: 'alert',
  error: 'alert',
  security: 'shield',
  session: 'clock',
};

/**
 * Dải thông báo nằm trong trang. Lỗi và cảnh báo bảo mật dùng `role="alert"` để trình đọc màn hình
 * đọc ngay; thông tin thường dùng `role="status"`.
 */
export function Banner({ tone = 'info', title, children, actions }) {
  const urgent = tone === 'error' || tone === 'security';
  return (
    <div className={`banner banner-${tone}`} role={urgent ? 'alert' : 'status'}>
      <Icon name={TONE_ICON[tone] ?? 'alert'} className="banner-icon" />
      <div className="banner-text">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {actions && <div className="banner-actions">{actions}</div>}
    </div>
  );
}

const ToastContext = createContext(null);

/** Thông báo nổi ở góc màn hình, tự ẩn. Tối đa 3 cái cùng lúc. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (message, tone = 'success') => {
      const id = ++nextId.current;
      setToasts((list) => [...list.slice(-2), { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === 'success' ? 3500 : 7000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={TONE_ICON[t.tone] ?? 'check'} />
            <span>{t.message}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => dismiss(t.id)}
              aria-label="Đóng thông báo"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** @returns {(message: string, tone?: 'success' | 'error' | 'security' | 'info') => void} */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast phải được dùng bên trong ToastProvider');
  return show;
}
