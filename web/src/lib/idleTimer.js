/**
 * Bộ đếm tự khóa khi không thao tác (AUTO_LOCK_MS). Tách khỏi React để test được.
 *
 * - Sau `timeoutMs - warnBeforeMs` không có hoạt động: gọi `onWarn` (hiện cảnh báo sắp khóa).
 * - Sau `timeoutMs`: gọi `onLock` đúng một lần rồi ngừng hẳn.
 * - Có hoạt động trong lúc đang cảnh báo: gọi `onActive` (ẩn cảnh báo) và đếm lại từ đầu.
 *
 * `checkElapsed()` dùng khi tab được mở lại hoặc máy thức dậy sau khi ngủ: bộ hẹn giờ của trình
 * duyệt có thể bị hoãn lúc đó, nên so trực tiếp với đồng hồ để không để lọt quá thời hạn.
 *
 * @param {object} options
 * @param {number} options.timeoutMs
 * @param {number} options.warnBeforeMs
 * @param {() => void} options.onLock
 * @param {() => void} [options.onWarn]
 * @param {() => void} [options.onActive]
 * @param {() => number} [options.now]
 */
export function createIdleTimer({
  timeoutMs,
  warnBeforeMs,
  onLock,
  onWarn,
  onActive,
  now = Date.now,
}) {
  let warnId;
  let lockId;
  let warned = false;
  let locked = false;
  let lastActivity = now();

  function clear() {
    clearTimeout(warnId);
    clearTimeout(lockId);
  }

  function lock() {
    if (locked) return;
    locked = true;
    clear();
    onLock();
  }

  function schedule() {
    clear();
    warnId = setTimeout(
      () => {
        warned = true;
        onWarn?.();
      },
      Math.max(0, timeoutMs - warnBeforeMs),
    );
    lockId = setTimeout(lock, timeoutMs);
  }

  return {
    start() {
      locked = false;
      warned = false;
      lastActivity = now();
      schedule();
    },
    activity() {
      if (locked) return;
      lastActivity = now();
      if (warned) {
        warned = false;
        onActive?.();
      }
      schedule();
    },
    checkElapsed() {
      if (!locked && now() - lastActivity >= timeoutMs) lock();
    },
    stop() {
      locked = true;
      clear();
    },
  };
}
