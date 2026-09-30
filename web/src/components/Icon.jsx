/**
 * Bộ icon nét mảnh, vẽ bằng SVG ngay trong mã: không tải gì từ bên ngoài (CSP `default-src 'self'`).
 * Luôn `aria-hidden`: ý nghĩa phải nằm ở chữ hoặc `aria-label` của nút chứa icon.
 */
const PATHS = {
  drop: 'M12 2.8c3.9 4.6 6.6 8.2 6.6 11.3a6.6 6.6 0 0 1-13.2 0c0-3.1 2.7-6.7 6.6-11.3z',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.6-4.6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  share:
    'M18 8a3 3 0 1 0-2.9-2.2L8.9 9.3a3 3 0 1 0 0 5.4l6.2 3.5A3 3 0 1 0 16 16l-6.2-3.5a3 3 0 0 0 0-1l6.2-3.5A3 3 0 0 0 18 8z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  key: 'M14.5 9.5a4.5 4.5 0 1 0-3.6 4.4L13 16h2v2h2v2h3v-3.2l-5.9-5.9',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff:
    'M3 3l18 18M10.6 5.1C11 5 11.5 5 12 5c6.4 0 10 7 10 7a16.8 16.8 0 0 1-3.1 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5v.01',
  shield: 'M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z',
  shieldCheck: 'M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6zM8.5 12l2.5 2.5 4.5-4.5',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  close: 'M6 6l12 12M18 6L6 18',
  users:
    'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  menu: 'M4 6h16M4 12h16M4 18h16',
  note: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h7M9 17h5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  device: 'M3 5h18v11H3zM8 20h8M12 16v4',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
};

/**
 * @param {{ name: keyof typeof PATHS, size?: number, className?: string }} props
 */
export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
