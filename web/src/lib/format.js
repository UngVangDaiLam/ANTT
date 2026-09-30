const time = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Thời điểm dễ đọc: "Hôm nay, 14:05", "Hôm qua, 09:30", hoặc "20/09/2026".
 * @param {string} iso
 * @param {Date} [now]
 */
export function formatWhen(iso, now = new Date()) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(when)) / 86_400_000);
  if (days === 0) return `Hôm nay, ${time.format(when)}`;
  if (days === 1) return `Hôm qua, ${time.format(when)}`;
  return date.format(when);
}

/** Tiêu đề hiển thị: tiêu đề rỗng hoặc toàn khoảng trắng thì ghi rõ là không có tiêu đề. */
export function displayTitle(title) {
  return title && title.trim() ? title : 'Không có tiêu đề';
}

/**
 * Như formatWhen nhưng ngày cũ vẫn kèm giờ ("20/09/2026, 14:05"): lịch sử đăng nhập cần biết đúng lúc.
 * @param {string} iso
 * @param {Date} [now]
 */
export function formatDateTime(iso, now = new Date()) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const short = formatWhen(iso, now);
  return short.includes(',') ? short : `${short}, ${time.format(when)}`;
}

const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/**
 * Tên thiết bị dễ đọc từ User-Agent, ví dụ "Chrome trên Windows". Chỉ để người dùng nhận ra thiết bị
 * của mình; User-Agent do trình duyệt tự khai nên không dùng vào việc gì liên quan tới bảo mật.
 * @param {string | null} userAgent
 */
export function describeDevice(userAgent) {
  if (!userAgent) return 'Thiết bị không rõ';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} trên ${system}`;
  return browser ?? system ?? 'Trình duyệt không rõ';
}
