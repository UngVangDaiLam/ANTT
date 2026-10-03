import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { applyTheme, currentTheme, readSavedTheme, saveTheme } from '../lib/theme.js';

/**
 * Nút chuyển sáng/tối (D89). Khi người dùng chưa tự chọn, đi theo hệ điều hành kể cả lúc hệ điều
 * hành đổi chế độ trong khi đang mở trang.
 * @param {{ className?: string }} props
 */
export function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => {
      if (readSavedTheme()) return;
      const next = currentTheme();
      applyTheme(next);
      setTheme(next);
    };
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Chuyển sang chế độ tối' : 'Chuyển sang chế độ sáng';

  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
      aria-label={label}
      title={label}
    >
      <Icon name={next === 'dark' ? 'moon' : 'sun'} />
    </button>
  );
}
