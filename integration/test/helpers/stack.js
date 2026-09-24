/**
 * Dựng server thật (Fastify, đúng code chạy production) trên một cổng ngẫu nhiên, và tạo các
 * "trình duyệt" giả lập để client-sdk thật nói chuyện với nó qua HTTP thật.
 *
 * integration/ là nơi DUY NHẤT được dùng cả server lẫn client-sdk (xem .dependency-cruiser.cjs).
 * Server được import bằng đường dẫn tương đối vì nó không phải thư viện, không có `exports`.
 */
import { SecureNoteClient, createFetchTransport } from '@secure-notes/client-sdk';
import { buildApp } from '../../../server/src/app.js';
import { loadConfig } from '../../../server/src/config.js';

export { backends } from '../../../server/test/helpers/backends.js';

/** Origin của giao diện. Trình duyệt thật tự gửi header này với mọi request thay đổi dữ liệu. */
export const ORIGIN = 'http://localhost:5173';

/**
 * Chạy server trên 127.0.0.1 với cổng do hệ điều hành chọn.
 * Mỗi test một server riêng: rate limit (lưu trong bộ nhớ theo từng instance) không lan sang test khác.
 * @param {object} db Prisma client hoặc DB giả
 */
export async function startServer(db) {
  const app = await buildApp({ config: loadConfig({ ALLOWED_ORIGINS: ORIGIN }), db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => app.close() };
}

/** Cập nhật cookie jar theo các header Set-Cookie, gồm cả lệnh xóa cookie (Max-Age=0 / Expires cũ). */
function storeCookies(jar, setCookieHeaders) {
  for (const header of setCookieHeaders) {
    const [pair, ...attributes] = header.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const attrs = Object.fromEntries(
      attributes.map((a) => {
        const i = a.indexOf('=');
        return i === -1 ? [a.toLowerCase(), true] : [a.slice(0, i).toLowerCase(), a.slice(i + 1)];
      }),
    );
    const expired =
      value === '' ||
      attrs['max-age'] === '0' ||
      (attrs.expires && new Date(attrs.expires).getTime() <= Date.now());
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
}

/**
 * Một trình duyệt: cookie jar riêng, gửi `Origin` với request thay đổi dữ liệu, ghi lại toàn bộ những
 * gì gửi đi (để kiểm tra server có bao giờ nhận được bản rõ không), và cho phép test đóng vai server
 * độc hại bằng cách thay response trước khi client-sdk nhìn thấy.
 *
 * Giới hạn: jar KHÔNG thi hành thuộc tính `Secure` (test chạy trên http://127.0.0.1). Việc server đặt
 * đủ thuộc tính cho cookie được kiểm tra riêng ở server/test/auth.test.js.
 */
export function createBrowser() {
  const cookies = new Map();
  /** @type {Array<{ method: string, path: string, body: string }>} */
  const sent = [];
  let interceptor = null;

  async function browserFetch(url, init = {}) {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    if (method !== 'GET' && method !== 'HEAD') headers.set('origin', ORIGIN);

    const path = new URL(url).pathname;
    sent.push({ method, path, body: typeof init.body === 'string' ? init.body : '' });

    const response = await fetch(url, { ...init, headers });
    storeCookies(cookies, response.headers.getSetCookie());

    if (interceptor) {
      const replaced = await interceptor({ method, path, response });
      if (replaced) return replaced;
    }
    return response;
  }

  return {
    fetch: browserFetch,
    cookies,
    sent,
    /** Toàn bộ những gì trình duyệt này đã gửi lên server: đường dẫn và body. */
    wire: () => sent.map((r) => `${r.method} ${r.path}\n${r.body}`).join('\n'),
    /** Đóng vai server độc hại: `fn` trả về Response thay thế, hoặc undefined để giữ nguyên. */
    intercept(fn) {
      interceptor = fn;
    },
  };
}

/** Tạo một người dùng: một trình duyệt + một SecureNoteClient dùng fetchTransport thật. */
export function createUser(baseUrl) {
  const browser = createBrowser();
  const client = new SecureNoteClient(createFetchTransport(baseUrl, { fetch: browser.fetch }));
  return { browser, client };
}

/**
 * Đọc JSON của response thật, cho `mutate` sửa, rồi trả về response giả mang dữ liệu đã sửa.
 * @param {Response} response
 * @param {(body: any) => any} mutate trả về body mới (hoặc sửa tại chỗ và trả undefined)
 */
export async function tamperJson(response, mutate) {
  const body = await response.json();
  const next = mutate(body) ?? body;
  return new Response(JSON.stringify(next), {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
