import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ApiError } from '@secure-notes/client-sdk';
import { LIMITS, SESSION } from '@secure-notes/shared';
import { backends, createBrowser, createUser, startServer, tamperJson } from './helpers/stack.js';

/**
 * client-sdk THẬT (Argon2id, XChaCha20-Poly1305, X25519, Ed25519 thật) gọi server THẬT qua HTTP
 * thật. Test đơn vị của hai bên đều dùng đồ giả ở phía bên kia (memoryTransport ở SDK, body viết tay ở
 * server), nên chỉ ở đây mới phát hiện được hai bên hiểu hợp đồng API khác nhau.
 */
describe.each(backends)('client-sdk ↔ server [$name]', (backend) => {
  let server;

  beforeEach(async () => {
    server = await startServer(await backend.create());
  });

  afterEach(() => server.close());

  const user = () => createUser(server.baseUrl);

  describe('luồng của người dùng', () => {
    test('đăng ký, ghi note, đọc lại; đăng xuất rồi đăng nhập ở trình duyệt khác vẫn đọc được', async () => {
      const laptop = user();
      await laptop.client.register('alice@example.com', 'mat-khau-cua-alice');
      expect(await laptop.client.listNotes()).toEqual([]);

      const first = await laptop.client.createNote({ title: 'Việc cần làm', content: 'Mua sữa' });
      const second = await laptop.client.createNote({ title: 'Mật mã', content: 'Không nói ai' });

      const list = await laptop.client.listNotes();
      expect(list.map((n) => n.title).sort()).toEqual(['Mật mã', 'Việc cần làm']);
      expect((await laptop.client.readNote(first.id)).content).toBe('Mua sữa');

      await laptop.client.logout();
      expect(laptop.client.isLoggedIn()).toBe(false);

      const phone = user();
      await phone.client.login('  ALICE@example.com ', 'mat-khau-cua-alice');
      const note = await phone.client.readNote(second.id);
      expect(note).toMatchObject({ title: 'Mật mã', content: 'Không nói ai', version: 1 });
      expect(note.sharedBy).toBeNull();
    });

    test('sai mật khẩu và email không tồn tại cho ra cùng một lỗi, không tạo phiên', async () => {
      await user().client.register('alice@example.com', 'mat-khau-dung');

      const wrongPassword = user();
      const unknownEmail = user();
      const a = wrongPassword.client.login('alice@example.com', 'mat-khau-sai');
      const b = unknownEmail.client.login('khong-co@example.com', 'mat-khau-dung');

      await expect(a).rejects.toBeInstanceOf(ApiError);
      await expect(a).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(b).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      // Email lạ vẫn đi hết luồng: nhận salt giả (D15), chạy Argon2id, rồi mới bị từ chối.
      expect(unknownEmail.browser.sent.map((r) => r.path)).toEqual([
        '/api/users/khong-co%40example.com/salt',
        '/api/login',
      ]);
      expect(wrongPassword.client.isLoggedIn()).toBe(false);
      expect(wrongPassword.browser.cookies.size).toBe(0);
      expect(unknownEmail.browser.cookies.size).toBe(0);
    });

    test('đăng ký trùng email báo EMAIL_TAKEN', async () => {
      await user().client.register('alice@example.com', 'mk-1-dai-hon');
      await expect(
        user().client.register('ALICE@example.com', 'mk-2-dai-hon'),
      ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    });

    test('chia sẻ: người nhận đọc được, người thứ ba nhận NOT_FOUND', async () => {
      const alice = user();
      const bob = user();
      const eve = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      await bob.client.register('bob@example.com', 'mk-bob-dai');
      await eve.client.register('eve@example.com', 'mk-eve-dai');

      const { id } = await alice.client.createNote({ title: 'Cho Bob', content: 'Hẹn 7 giờ' });
      await alice.client.shareNote(id, 'BOB@example.com');

      const inbox = await bob.client.listSharedWithMe();
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({ noteId: id, senderEmail: 'alice@example.com' });

      const read = await bob.client.readNote(id);
      expect(read).toMatchObject({
        title: 'Cho Bob',
        content: 'Hẹn 7 giờ',
        sharedBy: 'alice@example.com',
      });

      await expect(eve.client.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // Bob không phải chủ nên không chia sẻ tiếp được.
      await expect(bob.client.shareNote(id, 'eve@example.com')).rejects.toThrow();
      expect(await eve.client.listSharedWithMe()).toEqual([]);
    });

    test('đổi mật khẩu: phiên ở thiết bị khác bị hủy, dữ liệu và chia sẻ còn nguyên', async () => {
      const laptop = user();
      const bob = user();
      await laptop.client.register('alice@example.com', 'mat-khau-cu-dai');
      await bob.client.register('bob@example.com', 'mk-bob-dai');
      const { id } = await laptop.client.createNote({ title: 'Trước', content: 'Nội dung cũ' });
      await laptop.client.shareNote(id, 'bob@example.com');

      const phone = user();
      await phone.client.login('alice@example.com', 'mat-khau-cu-dai');

      await laptop.client.changePassword('mat-khau-cu-dai', 'mat-khau-moi-dai');

      // Thiết bị đổi mật khẩu vẫn dùng tiếp được; thiết bị kia bị đăng xuất ở phía server.
      expect(await laptop.client.listNotes()).toHaveLength(1);
      await expect(phone.client.listNotes()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      // Đăng xuất một phiên đã bị server hủy không được báo lỗi (D56).
      await expect(phone.client.logout()).resolves.toBeUndefined();

      await expect(
        user().client.login('alice@example.com', 'mat-khau-cu-dai'),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      const fresh = user();
      await fresh.client.login('alice@example.com', 'mat-khau-moi-dai');
      expect((await fresh.client.readNote(id)).content).toBe('Nội dung cũ');
      expect((await bob.client.readNote(id)).content).toBe('Nội dung cũ');
    });

    test('đổi mật khẩu với mật khẩu cũ sai bị server từ chối, mật khẩu cũ vẫn dùng được', async () => {
      const alice = user();
      await alice.client.register('alice@example.com', 'mat-khau-dung-dai');

      await expect(
        alice.client.changePassword('mat-khau-sai-dai', 'mat-khau-moi-dai'),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

      // Vẫn đăng nhập trên trình duyệt này, và mật khẩu cũ vẫn đúng.
      expect(await alice.client.listNotes()).toEqual([]);
      await user().client.login('alice@example.com', 'mat-khau-dung-dai');
    });

    test('đăng xuất hủy phiên ở server: dùng lại cookie cũ bị từ chối', async () => {
      const alice = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      const oldToken = alice.browser.cookies.get(SESSION.COOKIE_NAME);
      expect(oldToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      await alice.client.logout();

      expect(alice.browser.cookies.has(SESSION.COOKIE_NAME)).toBe(false);
      const replay = await fetch(`${server.baseUrl}/api/me`, {
        headers: { cookie: `${SESSION.COOKIE_NAME}=${oldToken}` },
      });
      expect(replay.status).toBe(401);
    });

    test('nội dung quá lớn bị chặn ngay ở client, không có request nào được gửi', async () => {
      const alice = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      const before = alice.browser.sent.length;

      await expect(
        alice.client.createNote({
          title: 'To',
          content: 'a'.repeat(LIMITS.MAX_NOTE_PLAINTEXT_BYTES + 1),
        }),
      ).rejects.toThrow('vượt giới hạn');
      expect(alice.browser.sent.length).toBe(before);
    });
  });

  describe('mã hóa đầu cuối: server không bao giờ nhận được bản rõ', () => {
    test('mật khẩu, tiêu đề, nội dung không xuất hiện trong bất kỳ byte nào gửi lên server', async () => {
      const PASSWORD = 'MAT-KHAU-KHONG-DUOC-ROI-TRINH-DUYET';
      const NEW_PASSWORD = 'MAT-KHAU-MOI-CUNG-KHONG-DUOC-ROI';
      const TITLE = 'TIEU-DE-CHI-NGUOI-DUNG-BIET';
      const CONTENT = 'NOI-DUNG-TUYET-MAT-CHI-NGUOI-DUNG-BIET';
      const alice = user();
      const bob = user();

      await alice.client.register('alice@example.com', PASSWORD);
      await bob.client.register('bob@example.com', 'mk-bob-dai');
      const { id } = await alice.client.createNote({ title: TITLE, content: CONTENT });
      await alice.client.shareNote(id, 'bob@example.com');
      expect((await bob.client.readNote(id)).content).toBe(CONTENT); // luồng thật sự chạy
      await alice.client.changePassword(PASSWORD, NEW_PASSWORD);
      await alice.client.logout();
      await user().client.login('alice@example.com', NEW_PASSWORD);

      const wire = alice.browser.wire() + bob.browser.wire();
      expect(wire.length).toBeGreaterThan(1000); // chắc chắn đã ghi lại được dữ liệu thật
      for (const secret of [PASSWORD, NEW_PASSWORD, TITLE, CONTENT]) {
        expect(wire).not.toContain(secret);
        // Cả dạng base64 của bản rõ cũng không được có mặt.
        expect(wire).not.toContain(Buffer.from(secret).toString('base64url').slice(0, 20));
      }
    });

    test('client không bao giờ tự khai danh tính trong body của thao tác cần đăng nhập (D16)', async () => {
      const alice = user();
      const bob = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      await bob.client.register('bob@example.com', 'mk-bob-dai');
      const { id } = await alice.client.createNote({ title: 'T', content: 'C' });
      await alice.client.shareNote(id, 'bob@example.com');

      const bodies = alice.browser.sent
        .filter((r) => !['/api/register', '/api/login'].includes(r.path))
        .map((r) => r.body)
        .join('\n');
      for (const field of ['ownerEmail', 'senderEmail', 'ownerId', 'senderId', 'userId']) {
        expect(bodies).not.toContain(field);
      }
    });
  });

  describe('client không tin server (server độc hại)', () => {
    test('/salt trả tham số Argon2id yếu: client từ chối và KHÔNG gửi authKey đi (D48)', async () => {
      await user().client.register('alice@example.com', 'mk-alice-dai');
      const victim = user();
      victim.browser.intercept(async ({ path, response }) =>
        path.endsWith('/salt')
          ? tamperJson(response, (body) => ({
              ...body,
              kdfParams: { opslimit: 1, memlimit: 8192 },
            }))
          : undefined,
      );

      await expect(victim.client.login('alice@example.com', 'mk-alice-dai')).rejects.toThrow(
        'không đúng định dạng',
      );
      expect(victim.browser.sent.map((r) => r.path)).not.toContain('/api/login');
      expect(victim.client.isLoggedIn()).toBe(false);
    });

    test('response có trường lạ bị từ chối thay vì dùng tiếp', async () => {
      const alice = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      const { id } = await alice.client.createNote({ title: 'T', content: 'C' });
      alice.browser.intercept(async ({ method, path, response }) =>
        method === 'GET' && path === `/api/notes/${id}`
          ? tamperJson(response, (body) => ({ ...body, isAdmin: true }))
          : undefined,
      );

      await expect(alice.client.readNote(id)).rejects.toThrow('không đúng định dạng');
    });

    test('ciphertext bị sửa: giải mã thất bại, không trả về nội dung nào', async () => {
      const alice = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      const { id } = await alice.client.createNote({ title: 'T', content: 'Nội dung thật' });
      alice.browser.intercept(async ({ method, path, response }) =>
        method === 'GET' && path === `/api/notes/${id}`
          ? tamperJson(response, (body) => {
              const c = body.encryptedContent.ciphertext;
              body.encryptedContent.ciphertext = (c[0] === 'A' ? 'B' : 'A') + c.slice(1);
            })
          : undefined,
      );

      await expect(alice.client.readNote(id)).rejects.toThrow();
    });

    test('server tráo khóa công khai: fingerprint đổi, người dùng đối chiếu thủ công phát hiện được', async () => {
      const alice = user();
      const bob = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      await bob.client.register('bob@example.com', 'mk-bob-dai');
      const genuine = await alice.client.getFingerprint('bob@example.com');

      alice.browser.intercept(async ({ path, response }) =>
        path.endsWith('/keys')
          ? tamperJson(response, (body) => ({
              ...body,
              x25519PublicKey: Buffer.alloc(32, 7).toString('base64url'),
            }))
          : undefined,
      );
      const forged = await alice.client.getFingerprint('bob@example.com');

      // Giới hạn đã ghi trong THREAT_MODEL: client KHÔNG tự phát hiện được, chỉ đối chiếu tay mới thấy.
      expect(forged.x25519Fingerprint).not.toBe(genuine.x25519Fingerprint);
      expect(forged.ed25519Fingerprint).toBe(genuine.ed25519Fingerprint);
    });

    test('server trả trang lỗi HTML thay vì JSON: báo lỗi rõ ràng, không đổ vỡ khó hiểu', async () => {
      const alice = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      alice.browser.intercept(async ({ method, path }) =>
        method === 'GET' && path === '/api/notes'
          ? new Response('<html><body>502 Bad Gateway</body></html>', {
              status: 502,
              headers: { 'content-type': 'text/html' },
            })
          : undefined,
      );

      const attempt = alice.client.listNotes();
      await expect(attempt).rejects.toBeInstanceOf(ApiError);
      await expect(attempt).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    });

    test('một request giả mạo từ trang web khác (Origin lạ) bị server chặn', async () => {
      const alice = user();
      await alice.client.register('alice@example.com', 'mk-alice-dai');
      const token = alice.browser.cookies.get(SESSION.COOKIE_NAME);

      // Trình duyệt vẫn gửi kèm cookie (giả sử SameSite bị lách), nhưng Origin là của kẻ tấn công.
      const res = await fetch(`${server.baseUrl}/api/logout`, {
        method: 'POST',
        headers: { cookie: `${SESSION.COOKIE_NAME}=${token}`, origin: 'https://evil.example' },
      });

      expect(res.status).toBe(403);
      expect(await alice.client.listNotes()).toEqual([]); // phiên vẫn sống
    });
  });
});

describe('dụng cụ test', () => {
  test('cookie jar xử lý đúng lệnh xóa cookie của server', async () => {
    const browser = createBrowser();
    const res = (cookies) => new Response(null, { headers: cookies.map((c) => ['set-cookie', c]) });
    const original = globalThis.fetch;
    let next;
    globalThis.fetch = async () => next;
    try {
      next = res(['a=1; Path=/; HttpOnly', 'b=2; Max-Age=60']);
      await browser.fetch('http://x.test/');
      expect([...browser.cookies]).toEqual([
        ['a', '1'],
        ['b', '2'],
      ]);
      next = res(['a=; Max-Age=0', 'b=2; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);
      await browser.fetch('http://x.test/');
      expect(browser.cookies.size).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
