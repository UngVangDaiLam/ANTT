/**
 * Độ tương phản của bảng màu (D68, D89), đọc thẳng từ biến trong `src/index.css` nên đổi màu mà quên
 * kiểm tra là test đỏ. Ngưỡng WCAG 2.1 AA: chữ thường 4.5:1.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

/** Lấy các biến màu dạng `--ten: #rrggbb;` trong khối CSS bắt đầu bằng `selector`. */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`không thấy khối ${selector}`);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...block.matchAll(/^\s*--([\w-]+):\s*(#[0-9a-f]{6});/gim)].map(([, k, v]) => [k, v]),
  );
}

const light = tokens(':root');
const THEMES = { light, dark: { ...light, ...tokens(":root[data-theme='dark']") } };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Chữ / nền thực sự xuất hiện cùng nhau trên giao diện.
const PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-muted'],
  ['text', 'accent-soft'], // ghi chú đang chọn, ô mã xác minh
  ['text-2', 'bg'],
  ['text-2', 'surface'],
  ['text-2', 'surface-muted'],
  ['text-2', 'accent-soft'],
  ['accent', 'surface'], // liên kết, tab đang chọn
  ['accent', 'surface-muted'],
  ['accent', 'accent-soft'], // "Đã lưu", số đếm ở thanh bên
  ['accent-hover', 'accent-soft'], // dải thông báo thông tin
  ['on-accent', 'accent-fill'], // nút chính, huy hiệu
  ['on-accent', 'accent-fill-hover'],
  ['on-accent', 'danger-fill'], // nút Xóa
  ['on-accent', 'danger-hover'],
  ['danger', 'surface'], // lỗi dưới ô nhập
  ['danger-ink', 'danger-soft'], // dải lỗi, thông báo lỗi
  ['warning-ink', 'warning-soft'],
];

describe.each(Object.entries(THEMES))('độ tương phản chế độ %s', (_name, theme) => {
  test.each(PAIRS)('%s trên %s đạt AA (4.5:1)', (fg, bg) => {
    expect(theme[fg], `thiếu biến --${fg}`).toBeDefined();
    expect(theme[bg], `thiếu biến --${bg}`).toBeDefined();
    expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

test('hàm đo đúng với giá trị chuẩn (đen/trắng 21:1, trùng màu 1:1)', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrast('#52627a', '#52627a')).toBe(1);
  expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
});
