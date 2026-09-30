/**
 * Kiểm tra giao diện bằng Chrome THẬT (headless), điều khiển qua DevTools Protocol: đi hết các luồng
 * chính trên khổ máy tính lẫn điện thoại, chụp ảnh từng bước vào web/e2e/shots/. Không cần thư viện
 * nào ngoài Node và Chrome (D83).
 *
 *   pnpm dev:server & pnpm dev:web          (hoặc bản triển khai HTTPS)
 *   pnpm --filter @secure-notes/web ui-check
 *
 * Biến môi trường:
 *   BASE         địa chỉ giao diện, mặc định http://localhost:5173/ (vd https://localhost/)
 *   CHROME_PATH  đường dẫn Chrome/Chromium nếu không nằm ở chỗ mặc định
 *
 * Script TẠO TÀI KHOẢN THỬ (alice…/bob…@example.com) trong database của máy chủ đang chạy. Chỉ chạy
 * vào máy chủ dev hoặc bản demo, không chạy vào nơi có người dùng thật.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchPage, sleep } from './cdp.mjs';

const BASE = process.env.BASE ?? 'http://localhost:5173/';
const OUT = new URL('./shots/', import.meta.url);

mkdirSync(OUT, { recursive: true });
const page = await launchPage();
const { send, js, consoleErrors } = page;
const waitFor = page.waitFor;

// ---------------------------------------------------------------- tiện ích thao tác

const pageHas = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
const waitText = (text, ms) => waitFor(pageHas(text), text, ms);

/** Biểu thức JS tìm phần tử đầu tiên khớp `selector` và có chứa `text`. */
const byText = (selector, text) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})]` +
  `.find((e) => e.textContent.trim().includes(${JSON.stringify(text)}))`;

async function click(selector, text) {
  const find = text
    ? byText(selector, text)
    : `document.querySelector(${JSON.stringify(selector)})`;
  const ok = await js(
    `(() => { const e = ${find}; if (!e) return false; e.click(); return true; })()`,
  );
  if (!ok) throw new Error(`không thấy ${selector} ${text ?? ''}`);
  await sleep(150);
}

async function key(keyName, code, keyCode, modifiers = 0) {
  const base = { key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/** Gõ chữ như bàn phím thật (đi qua sự kiện của React). `clear` xóa nội dung cũ trước. */
async function type(selector, text, { clear = true } = {}) {
  const ok = await js(
    `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false;` +
      ` e.focus(); ${clear ? 'e.select?.();' : ''} return true; })()`,
  );
  if (!ok) throw new Error(`không thấy ô ${selector}`);
  if (clear) await key('Backspace', 'Backspace', 8);
  await send('Input.insertText', { text });
  await sleep(80);
}

async function typeLabel(label, text) {
  const id = await js(
    `(() => { const l = ${byText('label', label)}; return l ? l.htmlFor : null; })()`,
  );
  if (!id) throw new Error(`không thấy nhãn ${label}`);
  await type(`[id="${id}"]`, text);
}

const ctrlS = () => key('s', 'KeyS', 83, 2);
const viewport = (width, height, mobile = false) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });

let shotNo = 0;
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${String(++shotNo).padStart(2, '0')}-${name}.png`;
  writeFileSync(new URL(file, OUT), Buffer.from(data, 'base64'));
}

/** "Thiết bị thứ hai": client-sdk thật chạy trong Node, cùng máy chủ. */
function otherDevice(...args) {
  const env = { ...process.env, BASE };
  // Chứng chỉ tự ký của bản demo localhost; không bao giờ tắt kiểm tra với máy chủ khác.
  if (new URL(BASE).hostname === 'localhost') env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./other-device.mjs', import.meta.url)), ...args],
    { env, stdio: 'inherit' },
  );
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (err) {
    results.push([false, `${name} -> ${err.message}`]);
    await shot(`FAIL-${name.slice(0, 30).replace(/[^\w]+/g, '_')}`).catch(() => {});
  }
}

// ---------------------------------------------------------------- các luồng

const stamp = Date.now();
const ALICE = `alice${stamp}@example.com`;
const BOB = `bob${stamp}@example.com`;
const PW_A = 'mot cau mat khau du dai cua alice';
const PW_B = 'mot cau mat khau du dai cua bob';
const NOTE_1 = 'Kế hoạch dự án';
const NOTE_2 = 'Ghi chú thứ hai';

async function register(email, password) {
  await click('.segmented button', 'Đăng ký');
  await type('#auth-email', email);
  await typeLabel('Mật khẩu', password);
  await typeLabel('Nhập lại mật khẩu', password);
  await click('button[type=submit]');
  await waitFor(`!!document.querySelector('.app-shell')`, 'vào khung làm việc');
}

async function logout() {
  await click('button[aria-label="Đăng xuất"]');
  await waitFor(`!!document.querySelector('#auth-email')`, 'về màn hình đăng nhập');
}

const savedPill = `document.querySelector('.status-pill')?.textContent.includes('Đã lưu')`;
const submitDisabled = `document.querySelector('button[type=submit]').disabled`;

await viewport(1440, 900);
await send('Page.navigate', { url: BASE });
await waitFor(`!!document.querySelector('#auth-email')`, 'màn hình đăng nhập');
await sleep(400);

await step('không tải tài nguyên từ bên ngoài (D72)', async () => {
  const external = await js(
    `performance.getEntriesByType('resource').map((e) => e.name)` +
      `.filter((n) => !n.startsWith(location.origin))`,
  );
  if (external.length) throw new Error(external.join(', '));
  await shot('login');
});

await step('đăng ký: mật khẩu phổ biến bị báo ngay, nút bị khóa', async () => {
  await click('.segmented button', 'Đăng ký');
  await type('#auth-email', BOB);
  await typeLabel('Mật khẩu', 'password1');
  await waitText('phổ biến');
  if (!(await js(submitDisabled))) throw new Error('nút Tạo tài khoản vẫn bấm được');
  await shot('register-weak');
});

await step('đăng ký: hai mật khẩu không khớp thì báo và khóa nút', async () => {
  await typeLabel('Mật khẩu', PW_B);
  await typeLabel('Nhập lại mật khẩu', `${PW_B}x`);
  await waitText('chưa khớp');
  if (!(await js(submitDisabled))) throw new Error('nút vẫn bấm được');
  await typeLabel('Nhập lại mật khẩu', PW_B);
});

await step('đăng ký Bob rồi đăng xuất', async () => {
  await click('button[type=submit]');
  await waitFor(`!!document.querySelector('.app-shell')`, 'vào khung làm việc');
  await sleep(300);
  await shot('empty-dashboard');
  await logout();
});

await step('đăng nhập sai mật khẩu: báo lỗi thân thiện', async () => {
  await click('.segmented button', 'Đăng nhập');
  await type('#auth-email', BOB);
  await typeLabel('Mật khẩu', 'sai mat khau roi');
  await click('button[type=submit]');
  await waitText('Email hoặc mật khẩu không đúng');
});

await step('đăng ký Alice', () => register(ALICE, PW_A));

await step('ghi chú mới: tiêu đề được chọn sẵn để gõ đè', async () => {
  await click('.btn-accent');
  await waitFor(`document.activeElement?.classList.contains('editor-title')`, 'focus tiêu đề');
  await send('Input.insertText', { text: NOTE_1 });
  await type('.editor-content', 'Tuần 1: làm server.\nTuần 2: làm giao diện.', { clear: false });
  await waitFor(
    `document.querySelector('.status-pill')?.textContent.includes('Chưa lưu')`,
    'Chưa lưu',
  );
  await shot('editor-dirty');
});

await step('Ctrl+S lưu; tiêu đề không bị bôi đen lại sau khi lưu', async () => {
  await ctrlS();
  await waitFor(savedPill, 'Đã lưu');
  await waitFor(`${byText('.nav-title', NOTE_1)} !== undefined`, 'tiêu đề trong danh sách');
  await sleep(300);
  const reselected = await js(
    `(() => { const t = document.querySelector('.editor-title');` +
      ` return document.activeElement === t && t.selectionEnd > t.selectionStart; })()`,
  );
  if (reselected) throw new Error('tiêu đề bị bôi đen lại: gõ tiếp sẽ xóa mất tiêu đề');
  await shot('editor-saved');
});

await step('chia sẻ: chỉ bấm được sau khi xác nhận đã đối chiếu mã', async () => {
  await click('.toolbar-actions .btn-secondary', 'Chia sẻ');
  await waitFor(`!!document.querySelector('#share-email')`, 'hộp thoại chia sẻ');
  await type('#share-email', BOB);
  await click('.modal button[type=submit]');
  await waitFor(`!!document.querySelector('.fingerprint code')`, 'mã fingerprint');
  const shareBtn = byText('.modal .btn-primary', 'Chia sẻ');
  if (!(await js(`${shareBtn}.disabled`))) throw new Error('bấm được khi CHƯA xác nhận');
  await shot('share-verify');
  await click('.modal .checkbox input');
  await js(`${shareBtn}.click()`);
  await waitText('Thu hồi quyền');
  await shot('share-people');
});

await step('thu hồi quyền: giải thích rõ, xong thì danh sách trống', async () => {
  await click('.people-actions .btn-danger', 'Thu hồi quyền');
  await waitText('mã hóa lại bằng khóa mới');
  await click('.modal-footer .btn-danger', 'Thu hồi quyền');
  await waitText('chưa được chia sẻ cho ai');
  await click('.modal-header .icon-btn');
});

await step('sau thu hồi (version tăng) vẫn lưu bình thường, không báo xung đột', async () => {
  await type('.editor-content', '\nTuần 3: nộp bài.', { clear: false });
  await ctrlS();
  await waitFor(savedPill, 'lưu được sau thu hồi');
  if (await js(pageHas('sửa ở nơi khác'))) throw new Error('báo xung đột sai');
});

await step('mã xác minh của tôi', async () => {
  await click('button[aria-label="Mã xác minh của tôi"]');
  await waitFor(`!!document.querySelector('.fingerprint code')`, 'mã của tôi');
  await shot('my-fingerprint');
  await click('.modal-footer .btn-primary', 'Đóng');
});

await step('đổi mật khẩu: báo lỗi ngay trên form', async () => {
  await click('button[aria-label="Đổi mật khẩu"]');
  await waitText('Mật khẩu hiện tại');
  await typeLabel('Mật khẩu hiện tại', PW_A);
  await typeLabel('Mật khẩu mới', PW_A);
  await waitText('phải khác mật khẩu hiện tại');
  await click('.modal-actions .btn-secondary', 'Hủy');
});

await step('đang sửa dở mà bấm ghi chú khác: hỏi lại trước khi mất chữ', async () => {
  await click('.btn-accent');
  await waitFor(`document.activeElement?.classList.contains('editor-title')`, 'ghi chú thứ hai');
  await send('Input.insertText', { text: NOTE_2 });
  await ctrlS();
  await waitFor(savedPill, 'lưu ghi chú 2');
  await type('.editor-content', 'đang gõ dở…', { clear: false });
  await click('.nav-item', NOTE_1);
  await waitText('Bỏ thay đổi chưa lưu?');
  await shot('unsaved-guard');
  await click('.modal-footer .btn-secondary', 'Hủy');
  if (!(await js(`document.querySelector('.editor-content').value.includes('đang gõ dở')`))) {
    throw new Error('mất chữ sau khi bấm Hủy');
  }
});

await step('xung đột: bản cũ lưu sau bị chặn, có nút tải bản mới nhất', async () => {
  otherDevice('edit', ALICE, PW_A, NOTE_2, 'Sửa từ thiết bị khác');
  await ctrlS();
  await waitText('Ghi chú vừa được sửa ở nơi khác');
  await shot('conflict');
  await click('.banner-actions .btn-primary', 'Tải bản mới nhất');
  await waitFor(
    `document.querySelector('.editor-content')?.value === 'Sửa từ thiết bị khác'`,
    'bản mới nhất',
  );
});

await step('thiết bị: 2 phiên, đánh dấu thiết bị này; lịch sử có lần sai mật khẩu', async () => {
  otherDevice('wrong-login', ALICE);
  await click('button[aria-label="Tài khoản và bảo mật"]');
  await waitFor(`document.querySelectorAll('.people-list li').length === 2`, '2 thiết bị');
  await waitText('Thiết bị này');
  await shot('sessions');
  await click('.tabs button', 'Lịch sử');
  await waitText('1 lần nhập sai mật khẩu gần đây');
  if (!(await js(`document.querySelectorAll('.history-list li.is-failed').length === 1`))) {
    throw new Error('không tô đỏ lần sai');
  }
  await shot('login-history');
});

await step('đăng xuất thiết bị khác: sai mật khẩu bị báo, đúng thì còn 1 thiết bị', async () => {
  await click('.tabs button', 'Thiết bị');
  await click('.people-actions .btn', 'Đăng xuất');
  await waitText('Xác nhận bằng mật khẩu');
  await typeLabel('Mật khẩu hiện tại', 'sai mat khau roi nhe');
  await click('form .btn-danger', 'Đăng xuất');
  await waitText('Mật khẩu không đúng', 30000);
  await typeLabel('Mật khẩu hiện tại', PW_A);
  await click('form .btn-danger', 'Đăng xuất');
  await waitFor(
    `document.querySelectorAll('.people-list li').length === 1 && !${pageHas('Xác nhận bằng mật khẩu')}`,
    'còn 1 thiết bị',
    30000,
  );
  await shot('sessions-after');
  await click('.modal-header .icon-btn');
});

await step('điện thoại: khung làm việc và ngăn kéo', async () => {
  await viewport(390, 844, true);
  await sleep(400);
  await shot('mobile-editor');
  await click('button[aria-label="Mở danh sách ghi chú"]');
  await sleep(400);
  await shot('mobile-drawer');
  await click('button[aria-label="Đóng danh sách"]');
});

await step(
  'xóa tài khoản: phải gõ đúng email và mật khẩu, xong thì về màn hình đăng nhập',
  async () => {
    await click('button[aria-label="Mở danh sách ghi chú"]');
    await click('button[aria-label="Tài khoản và bảo mật"]');
    await click('.tabs button', 'Xóa tài khoản');
    await waitText('Không thể hoàn tác');
    const deleteDisabled = byText('form .btn-danger', 'Xóa vĩnh viễn');
    await typeLabel('Mật khẩu hiện tại', PW_A);
    await type('#delete-confirm-email', 'nham@example.com');
    if (!(await js(`${deleteDisabled}.disabled`))) throw new Error('gõ sai email mà vẫn bấm được');
    await type('#delete-confirm-email', ALICE);
    await shot('mobile-delete-account');
    await click('form .btn-danger', 'Xóa vĩnh viễn');
    await waitText('đã được xóa vĩnh viễn', 30000);
    await shot('mobile-account-deleted');
  },
);

await step('sai mật khẩu nhiều lần: kể cả mật khẩu đúng cũng phải chờ (D81)', async () => {
  // Bob đã sai 1 lần ở trên; thêm 4 lần từ "máy khác" cho đủ 5.
  otherDevice('wrong-login', BOB, '4');
  await click('.segmented button', 'Đăng nhập');
  await type('#auth-email', BOB);
  await typeLabel('Mật khẩu', PW_B);
  await click('button[type=submit]');
  await waitText('thử quá nhiều lần', 30000);
  await shot('mobile-throttled');
});

await step('không có lỗi JavaScript trong console', async () => {
  // Lỗi HTTP mà giao diện đã xử lý (401 sai mật khẩu, 409 xung đột, 429 bị chặn) không tính.
  const errors = consoleErrors.filter((e) => !/40[19]|429|Unauthorized|Conflict|Too Many/.test(e));
  if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
});

for (const [ok, name] of results) console.log(ok ? 'OK  ' : 'FAIL', name);
console.log(
  `\n${results.filter(([ok]) => ok).length}/${results.length} bước đạt. Ảnh: ${fileURLToPath(OUT)}`,
);

await page.close();
process.exitCode = results.every(([ok]) => ok) ? 0 : 1;
