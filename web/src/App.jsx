import { useCallback, useState } from 'react';
import { AUTO_LOCK_MS } from '@secure-notes/client-sdk';
import { client } from './client.js';
import { useIdleLock } from './lib/useIdleLock.js';
import { ToastProvider } from './components/Feedback.jsx';
import { Icon } from './components/Icon.jsx';
import { AuthForm } from './AuthForm.jsx';
import { Dashboard } from './Dashboard.jsx';

/** Cảnh báo trước khi tự khóa bao lâu. */
const WARN_BEFORE_MS = 60 * 1000;
const LOCK_MINUTES = Math.round(AUTO_LOCK_MS / 60000);

/**
 * Khóa chỉ nằm trong bộ nhớ của tab này (không bao giờ ghi ra localStorage), nên tải lại trang là
 * phải đăng nhập lại — đó là chủ đích, không phải lỗi.
 */
export default function App() {
  const [email, setEmail] = useState(() => client.currentUserEmail());
  const [notice, setNotice] = useState(null);

  /**
   * Kết thúc phiên của `owner`: hủy phiên ở máy chủ và xóa khóa khỏi bộ nhớ, rồi về màn hình đăng nhập.
   * Nếu phiên hiện tại đã là của người khác (yêu cầu đến muộn từ phiên cũ) thì không làm gì.
   */
  const endSession = useCallback(async (owner, message) => {
    if (client.currentUserEmail() !== owner) return;
    try {
      await client.logout();
    } catch {
      // Mất mạng: khóa trong bộ nhớ vẫn đã bị xóa (SDK xóa trước khi báo lỗi).
    }
    setEmail(null);
    setNotice(message ?? null);
  }, []);

  const lockNow = useCallback(
    () =>
      endSession(client.currentUserEmail(), {
        tone: 'info',
        text: `Ứng dụng đã tự khóa sau ${LOCK_MINUTES} phút không thao tác để bảo vệ ghi chú của bạn. Hãy đăng nhập lại.`,
      }),
    [endSession],
  );

  const idleWarning = useIdleLock({
    enabled: email !== null,
    timeoutMs: AUTO_LOCK_MS,
    warnBeforeMs: WARN_BEFORE_MS,
    onLock: lockNow,
  });

  return (
    <ToastProvider>
      {email ? (
        <>
          {idleWarning && (
            <div className="idle-warning" role="alert">
              <Icon name="clock" />
              <span>
                Sắp tự khóa vì không có thao tác. Thay đổi chưa lưu sẽ bị mất. Di chuột hoặc bấm
                phím để tiếp tục.
              </span>
              <button type="button" className="btn btn-sm btn-secondary">
                Tôi vẫn đang dùng
              </button>
            </div>
          )}
          <Dashboard
            key={email}
            email={email}
            onSignOut={(message) => endSession(email, message)}
          />
        </>
      ) : (
        <AuthForm
          notice={notice}
          onSignedIn={(signedIn) => {
            setNotice(null);
            setEmail(signedIn);
          }}
        />
      )}
    </ToastProvider>
  );
}
