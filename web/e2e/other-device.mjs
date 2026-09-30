/**
 * "Thiết bị thứ hai" cho ui-check.mjs: client-sdk THẬT chạy trong Node, gọi tới cùng máy chủ với
 * trình duyệt đang được kiểm tra, có giữ cookie như một trình duyệt.
 *
 *   node other-device.mjs edit <email> <mật khẩu> <tiêu đề note> <nội dung mới>
 *   node other-device.mjs wrong-login <email> [số lần]
 */
import { SecureNoteClient, createFetchTransport } from '@secure-notes/client-sdk';

const BASE = (process.env.BASE ?? 'http://localhost:5173/').replace(/\/$/, '');

/** fetch có "hũ cookie": Node không tự giữ cookie phiên như trình duyệt. */
function cookieJarFetch() {
  const jar = new Map();
  return async (url, init = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(url, { ...init, headers });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
}

const newClient = () =>
  new SecureNoteClient(createFetchTransport(BASE, { fetch: cookieJarFetch() }));

const [command, ...args] = process.argv.slice(2);

if (command === 'edit') {
  const [email, password, title, content] = args;
  const client = newClient();
  await client.login(email, password);
  const target = (await client.listNotes()).find((n) => n.title === title);
  if (!target) throw new Error(`không thấy note "${title}"`);
  const current = await client.readNote(target.id);
  await client.updateNote(target.id, { title: current.title, content, version: current.version });
} else if (command === 'wrong-login') {
  const [email, times = '1'] = args;
  for (let i = 0; i < Number(times); i++) {
    await newClient()
      .login(email, 'day-la-mat-khau-sai')
      .catch(() => {
        // Đúng như mong đợi: sai mật khẩu.
      });
  }
} else {
  throw new Error(`lệnh không hợp lệ: ${command}`);
}
