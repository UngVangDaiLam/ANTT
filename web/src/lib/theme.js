/**
 * Chế độ sáng/tối (D89). Lựa chọn của người dùng nằm trong localStorage: đây chỉ là tùy chọn hiển thị,
 * không phải bí mật. Chưa chọn thì theo hệ điều hành. `public/theme-init.js` làm đúng việc của
 * `currentTheme` + `applyTheme` trước khi trang vẽ lần đầu, để không nháy màu sai.
 */

export const THEME_STORAGE_KEY = 'secure-notes:theme';
const THEMES = new Set(['light', 'dark']);
const THEME_COLOR = { light: '#f3f6fa', dark: '#0b1422' };

/**
 * Giá trị đọc từ localStorage không được tin: chỉ nhận `light`/`dark`, còn lại coi như chưa chọn.
 * @param {unknown} value
 * @returns {'light' | 'dark' | null}
 */
export function parseTheme(value) {
  return typeof value === 'string' && THEMES.has(value)
    ? /** @type {'light'|'dark'} */ (value)
    : null;
}

/**
 * @param {unknown} saved Giá trị đã lưu (có thể rác hoặc null).
 * @param {boolean} systemDark Hệ điều hành đang ở chế độ tối.
 * @returns {'light' | 'dark'}
 */
export function resolveTheme(saved, systemDark) {
  return parseTheme(saved) ?? (systemDark ? 'dark' : 'light');
}

function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** @returns {string | null} Lựa chọn đã lưu, hoặc null nếu chưa có / không đọc được. */
export function readSavedTheme() {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** @returns {'light' | 'dark'} Chế độ đang có hiệu lực. */
export function currentTheme() {
  return resolveTheme(readSavedTheme(), systemPrefersDark());
}

/**
 * Đặt chế độ lên trang (thuộc tính `data-theme` của `<html>` và màu thanh trình duyệt).
 * @param {'light' | 'dark'} theme
 */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', THEME_COLOR[theme]);
  }
}

/**
 * Người dùng chọn chế độ: áp dụng và ghi nhớ. Không ghi được (chế độ riêng tư) thì vẫn áp dụng.
 * @param {'light' | 'dark'} theme
 */
export function saveTheme(theme) {
  const valid = parseTheme(theme);
  if (!valid) return;
  applyTheme(valid);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, valid);
  } catch {
    // Bỏ qua: chỉ mất phần ghi nhớ.
  }
}
