/*
 * Đặt chế độ sáng/tối TRƯỚC khi trang vẽ lần đầu (D89), để không nháy màu sai. Là file riêng chứ không
 * viết thẳng vào index.html vì CSP `script-src 'self'` chặn script nội tuyến. Cùng logic với
 * src/lib/theme.js (currentTheme + applyTheme), giữ hai chỗ khớp nhau.
 */
{
  let saved = null;
  try {
    saved = localStorage.getItem('secure-notes:theme');
  } catch {
    // Chế độ riêng tư: theo hệ điều hành.
  }
  const theme =
    saved === 'light' || saved === 'dark'
      ? saved
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.dataset.theme = theme;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', theme === 'dark' ? '#0b1422' : '#f3f6fa');
  }
}
