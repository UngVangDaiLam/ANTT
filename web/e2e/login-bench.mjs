/**
 * Đo thời gian ĐĂNG NHẬP thật trong Chrome (Argon2id chạy bằng WebAssembly như với người dùng), với CPU
 * bị giả lập chậm đi theo các mức mà Chrome DevTools dùng cho điện thoại: 4x ≈ điện thoại tầm trung,
 * 6x ≈ điện thoại cấu hình thấp. Tính từ lúc bấm "Đăng nhập" tới lúc vào khung làm việc: gồm tra
 * salt, Argon2id, gọi /login, mở khóa và kiểm tra khóa công khai (D70).
 *
 *   BASE=https://localhost/ pnpm --filter @secure-notes/web login-bench
 *
 * Tạo MỘT tài khoản thử. Tổng cộng 1 + 3 × RUNS lần đăng nhập: với RUNS=3 là 10, đúng bằng giới hạn
 * đăng nhập theo IP (10 lần / 15 phút). Chạy lại ngay thì khởi động lại server trước.
 */
import { launchPage } from './cdp.mjs';

const BASE = process.env.BASE ?? 'http://localhost:5173/';
const RATES = [1, 4, 6];
const RUNS = 3;

const page = await launchPage();
const { send, js, waitFor } = page;

const byText = (selector, text) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})]` +
  `.find((e) => e.textContent.includes(${JSON.stringify(text)}))`;

async function typeInto(selector, text) {
  await js(
    `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select(); })()`,
  );
  const backspace = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...backspace });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...backspace });
  await send('Input.insertText', { text });
}

async function typeLabel(label, text) {
  const id = await js(`(${byText('label', label)}).htmlFor`);
  await typeInto(`[id="${id}"]`, text);
}

const inApp = `!!document.querySelector('.app-shell')`;
const onLogin = `!!document.querySelector('#auth-email')`;
const email = `bench${Date.now()}@example.com`;
const password = 'mot cau mat khau du dai de do toc do';

await send('Page.navigate', { url: BASE });
await waitFor(onLogin, 'màn hình đăng nhập');

// Đăng ký ở tốc độ thường; không tính vào kết quả.
await js(`${byText('.segmented button', 'Đăng ký')}.click()`);
await typeInto('#auth-email', email);
await typeLabel('Mật khẩu', password);
await typeLabel('Nhập lại mật khẩu', password);
await js(`document.querySelector('button[type=submit]').click()`);
await waitFor(inApp, 'đăng ký', 60000);

const results = new Map();
for (const rate of RATES) {
  const times = [];
  for (let run = 0; run < RUNS; run++) {
    await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await js(`document.querySelector('button[aria-label="Đăng xuất"]').click()`);
    await waitFor(onLogin, 'đăng xuất');
    await typeInto('#auth-email', email);
    await typeLabel('Mật khẩu', password);

    // Chỉ làm chậm đúng khoảng được đo.
    await send('Emulation.setCPUThrottlingRate', { rate });
    const start = Date.now();
    await js(`document.querySelector('button[type=submit]').click()`);
    await waitFor(inApp, `đăng nhập ở mức ${rate}x`, 120000);
    times.push(Date.now() - start);
  }
  results.set(rate, times);
}
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
await page.close();

console.log('Thời gian đăng nhập (bấm nút → vào khung làm việc):');
for (const [rate, times] of results) {
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  console.log(`  CPU chậm ${rate}x: trung vị ${median} ms  (các lần: ${times.join(', ')} ms)`);
}
