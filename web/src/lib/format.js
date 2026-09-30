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
