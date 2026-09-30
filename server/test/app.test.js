import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, loggableUrl } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { LIMITS, SESSION } from '@secure-notes/shared';
import { createFakeDb } from './helpers/fake-db.js';

let app;

beforeAll(async () => {
  app = await buildApp({ config: loadConfig({ ALLOWED_ORIGINS: 'http://localhost:5173' }) });
  // Route chỉ dùng trong test để kiểm tra lớp phòng thủ đầu vào.
  app.post(
    '/test/echo',
    {
      schema: {
        body: {
          type: 'object',
          properties: { title: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    async (request) => request.body,
  );
  await app.ready();
});

afterAll(() => app.close());

describe('server khung', () => {
  test('GET /api/health trả ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  test('route không tồn tại trả { code: NOT_FOUND }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/khong-co' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  test('từ chối JSON chứa __proto__ (Prototype Pollution)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"title":"x","__proto__":{"isAdmin":true}}',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect({}.isAdmin).toBeUndefined();
  });

  test('từ chối JSON chứa constructor.prototype', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"constructor":{"prototype":{"isAdmin":true}}}',
    });
    expect(res.statusCode).toBe(400);
  });

  test('từ chối trường lạ thay vì âm thầm xóa đi', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      payload: { title: 'x', ownerEmail: 'hacker@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('từ chối request vượt giới hạn kích thước', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      payload: { title: 'a'.repeat(LIMITS.MAX_REQUEST_BYTES + 1) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('từ chối request thay đổi dữ liệu từ Origin lạ (CSRF)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { origin: 'https://evil.example' },
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  test('có header bảo mật', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  test('đường dẫn cũ có email trên URL không còn tồn tại (D85)', async () => {
    for (const url of ['/api/users/a%40b.com/salt', '/api/users/a%40b.com/keys']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
    }
  });

  test('phản hồi API không được lưu cache, kể cả phản hồi lỗi (ASVS 14.3.2)', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/health' });
    const notFound = await app.inject({ method: 'GET', url: '/api/khong-co' });
    const forbidden = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { origin: 'https://evil.example' },
      payload: { title: 'x' },
    });
    for (const res of [ok, notFound, forbidden]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('ghi log lỗi không mong đợi', () => {
  const SECRET = 'BI_MAT_CIPHERTEXT_TRONG_THAM_SO';

  async function appWithFailingRoute(error) {
    const lines = [];
    const logged = await buildApp({
      config: loadConfig({}),
      logger: { level: 'trace', stream: { write: (line) => lines.push(line) } },
    });
    logged.get('/test/boom', async () => {
      throw error;
    });
    await logged.ready();
    const res = await logged.inject({ method: 'GET', url: '/test/boom' });
    await logged.close();
    return { res, output: lines.join('') };
  }

  test('lỗi Prisma: log có tên lớp và mã lỗi, KHÔNG có tham số truy vấn (ciphertext, khóa)', async () => {
    // Giống hệt hình dạng PrismaClientValidationError thật: message in nguyên đối tượng tham số.
    const prismaError = Object.assign(
      new Error(`Invalid \`prisma.note.create()\` invocation:
{ encryptedTitle: { ciphertext: "${SECRET}" } }`),
      { name: 'PrismaClientValidationError', clientVersion: '6.19.3' },
    );

    const { res, output } = await appWithFailingRoute(prismaError);

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ.' });
    expect(output).toContain('PrismaClientValidationError'); // vẫn đủ để biết chuyện gì xảy ra
    expect(output).not.toContain(SECRET);
  });

  test('lỗi Prisma có mã (ví dụ P2003) cũng chỉ ghi mã, không ghi message', async () => {
    const prismaError = Object.assign(new Error(`Foreign key failed, value ${SECRET}`), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2003',
      clientVersion: '6.19.3',
    });

    const { output } = await appWithFailingRoute(prismaError);

    expect(output).toContain('P2003');
    expect(output).not.toContain(SECRET);
  });

  test('lỗi thường của code (không phải Prisma) vẫn ghi đủ message để gỡ lỗi', async () => {
    const { res, output } = await appWithFailingRoute(new TypeError('thuoc-tinh-bi-thieu'));

    expect(res.statusCode).toBe(500);
    expect(output).toContain('thuoc-tinh-bi-thieu');
    // Response ra ngoài thì không bao giờ lộ message nội bộ.
    expect(res.body).not.toContain('thuoc-tinh-bi-thieu');
  });
});

describe('ghi log sự kiện bảo mật (ASVS 16.3.2)', () => {
  async function loggedApp() {
    const lines = [];
    const logged = await buildApp({
      config: loadConfig({ ALLOWED_ORIGINS: 'http://localhost:5173' }),
      logger: { level: 'info', stream: { write: (line) => lines.push(line) } },
      db: createFakeDb(),
    });
    await logged.ready();
    return {
      app: logged,
      events: () =>
        lines.map((line) => JSON.parse(line)).filter((entry) => entry.event === 'access_denied'),
      output: () => lines.join(''),
    };
  }

  test('chưa đăng nhập bị từ chối: ghi mã, method, mẫu route; KHÔNG ghi token trong cookie', async () => {
    const { app: logged, events, output } = await loggedApp();
    const token = 'T'.repeat(43);

    await logged.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION.COOKIE_NAME]: token },
    });
    await logged.close();

    expect(events()).toEqual([
      expect.objectContaining({
        code: 'UNAUTHENTICATED',
        method: 'GET',
        route: '/api/me',
        userId: null,
      }),
    ]);
    expect(output()).not.toContain(token);
  });

  test('email tra cứu nằm trong body nên không vào log, kể cả khi bị từ chối (D85)', async () => {
    const { app: logged, events, output } = await loggedApp();

    await logged.inject({
      method: 'POST',
      url: '/api/users/keys',
      payload: { email: 'bi-mat@example.com' },
    });
    await logged.inject({
      method: 'POST',
      url: '/api/users/salt',
      payload: { email: 'bi-mat@example.com' },
    });
    await logged.close();

    expect(events()[0]).toMatchObject({ route: '/api/users/keys', code: 'UNAUTHENTICATED' });
    expect(output()).not.toContain('bi-mat');
  });

  test('Origin lạ (CSRF) bị chặn cũng được ghi', async () => {
    const { app: logged, events } = await loggedApp();

    await logged.inject({
      method: 'POST',
      url: '/api/logout',
      headers: { origin: 'https://evil.example' },
    });
    await logged.close();

    expect(events()).toEqual([expect.objectContaining({ code: 'FORBIDDEN', method: 'POST' })]);
  });

  test('request hợp lệ không sinh sự kiện bảo mật', async () => {
    const { app: logged, events } = await loggedApp();
    await logged.inject({ method: 'GET', url: '/api/health' });
    await logged.close();
    expect(events()).toEqual([]);
  });
});

describe('loggableUrl', () => {
  test('bỏ query string, giữ nguyên đường dẫn', () => {
    expect(loggableUrl('/api/users/salt?email=a@b.com')).toBe('/api/users/salt');
    expect(loggableUrl('/api/notes/123?x=1')).toBe('/api/notes/123');
    expect(loggableUrl('/api/login')).toBe('/api/login');
  });
});
