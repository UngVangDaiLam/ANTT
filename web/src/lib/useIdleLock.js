import { useEffect, useRef, useState } from 'react';
import { createIdleTimer } from './idleTimer.js';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

/**
 * Tự khóa sau một khoảng không thao tác (AUTO_LOCK_MS). Trả về `true` khi đang trong thời gian
 * cảnh báo sắp khóa, để giao diện hiện lời nhắc.
 *
 * Mọi thao tác chuột, bàn phím, chạm, cuộn đều tính là hoạt động (gộp tối đa mỗi giây một lần cho
 * nhẹ). Khi tab được mở lại (hoặc máy thức dậy sau khi ngủ), so trực tiếp với đồng hồ để khóa ngay
 * nếu đã quá hạn, không chờ bộ hẹn giờ của trình duyệt vốn có thể bị hoãn.
 */
export function useIdleLock({ enabled, timeoutMs, warnBeforeMs, onLock }) {
  const [warning, setWarning] = useState(false);
  const onLockRef = useRef(onLock);

  useEffect(() => {
    onLockRef.current = onLock;
  }, [onLock]);

  useEffect(() => {
    if (!enabled) return undefined;

    const timer = createIdleTimer({
      timeoutMs,
      warnBeforeMs,
      onWarn: () => setWarning(true),
      onActive: () => setWarning(false),
      onLock: () => {
        setWarning(false);
        onLockRef.current();
      },
    });
    timer.start();

    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      timer.activity();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') timer.checkElapsed();
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      timer.stop();
      setWarning(false);
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, timeoutMs, warnBeforeMs]);

  return warning;
}
