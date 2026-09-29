import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { LIMITS, sealedCiphertextMaxLength } from '@secure-notes/shared';
import { backends, tick } from './helpers/backends.js';
import { b64, noteBody, rotateBody, sealed, sharePackage, updateBody } from './helpers/fixtures.js';
import { createHarness } from './helpers/harness.js';

const NOTE_LIST_KEYS = ['encryptedTitle', 'id', 'updatedAt', 'version', 'wrappedNoteKey'];
const NOTE_WRITE_KEYS = ['id', 'updatedAt', 'version'];

describe.each(backends)('note [$name]', (backend) => {
  let h;
  let alice;
  let bob;

  beforeEach(async () => {
    h = await createHarness(await backend.create());
    alice = await h.signUp('alice@example.com');
    bob = await h.signUp('bob@example.com');
  });

  afterEach(() => h.close());

  /** Tạo note cho `user`, trả về body đã gửi. */
  async function createNote(user = alice, overrides = {}) {
    const body = noteBody(overrides);
    const res = await user.req('POST', '/api/notes', body);
    expect(res.statusCode, res.body).toBe(201);
    return body;
  }

  /** Chia sẻ note cho `recipient`, trả về id của share. */
  async function shareTo(owner, noteId, recipient, pkg = sharePackage()) {
    const res = await owner.req('POST', `/api/notes/${noteId}/shares`, {
      recipientEmail: recipient.email,
      sharePackage: pkg,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id;
  }

  const getNote = (user, id) => user.req('GET', `/api/notes/${id}`);

  describe('POST /api/notes', () => {
    test('tạo thành công trả 201 với id, version 1 và updatedAt ISO', async () => {
      const body = noteBody();
      const res = await alice.req('POST', '/api/notes', body);

      expect(res.statusCode).toBe(201);
      expect(Object.keys(res.json()).sort()).toEqual(NOTE_WRITE_KEYS);
      expect(res.json()).toMatchObject({ id: body.id, version: 1 });
      expect(new Date(res.json().updatedAt).toISOString()).toBe(res.json().updatedAt);
    });

    test('chủ note lấy từ phiên: chỉ người tạo thấy note trong danh sách của mình', async () => {
      const body = await createNote(alice);
      expect((await alice.req('GET', '/api/notes')).json().map((n) => n.id)).toEqual([body.id]);
      expect((await bob.req('GET', '/api/notes')).json()).toEqual([]);
    });

    test('không nhận ownerId từ body (D16), trường lạ bị từ chối', async () => {
      const res = await alice.req('POST', '/api/notes', noteBody({ ownerId: 'someone-else' }));
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
      expect((await alice.req('GET', '/api/notes')).json()).toEqual([]);
    });

    test('version khác 1 khi tạo mới bị từ chối', async () => {
      const res = await alice.req('POST', '/api/notes', noteBody({ version: 2 }));
      expect(res.statusCode).toBe(400);
    });

    test('id đã tồn tại trả 409 NOTE_ID_TAKEN và không ghi đè note cũ', async () => {
      const original = await createNote(alice);
      const res = await alice.req(
        'POST',
        '/api/notes',
        noteBody({ id: original.id, encryptedContent: sealed() }),
      );

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('NOTE_ID_TAKEN');
      const stored = (await getNote(alice, original.id)).json();
      expect(stored.encryptedContent).toEqual(original.encryptedContent);
    });

    test('người khác dùng lại id của note đang có cũng bị từ chối, note gốc nguyên vẹn', async () => {
      const original = await createNote(alice);
      const res = await bob.req('POST', '/api/notes', noteBody({ id: original.id }));

      expect(res.statusCode).toBe(409);
      expect((await bob.req('GET', '/api/notes')).json()).toEqual([]);
      expect((await getNote(alice, original.id)).json().encryptedContent).toEqual(
        original.encryptedContent,
      );
    });

    test.each([
      ['không phải UUID', 'note-1'],
      ['UUID phiên bản 1', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
      ['UUID viết hoa', crypto.randomUUID().toUpperCase()],
    ])('id %s bị từ chối', async (_name, id) => {
      const res = await alice.req('POST', '/api/notes', noteBody({ id }));
      expect(res.statusCode).toBe(400);
    });

    test('thiếu trường bắt buộc bị từ chối', async () => {
      const body = noteBody();
      delete body.wrappedNoteKey;
      const res = await alice.req('POST', '/api/notes', body);
      expect(res.statusCode).toBe(400);
    });

    test('nonce sai độ dài bị từ chối', async () => {
      const res = await alice.req(
        'POST',
        '/api/notes',
        noteBody({ encryptedTitle: { nonce: b64(12), ciphertext: b64(48) } }),
      );
      expect(res.statusCode).toBe(400);
    });

    test('tiêu đề chạm đúng trần thì nhận, quá một ký tự thì từ chối', async () => {
      const max = sealedCiphertextMaxLength(LIMITS.MAX_NOTE_TITLE_BYTES);
      const title = (n) => ({ nonce: b64(24), ciphertext: 'A'.repeat(n) });

      const ok = await alice.req('POST', '/api/notes', noteBody({ encryptedTitle: title(max) }));
      const tooLong = await alice.req(
        'POST',
        '/api/notes',
        noteBody({ encryptedTitle: title(max + 1) }),
      );

      expect(ok.statusCode).toBe(201);
      expect(tooLong.statusCode).toBe(400);
    });

    test('nội dung chạm đúng trần thì nhận, quá một ký tự thì từ chối', async () => {
      const max = sealedCiphertextMaxLength(LIMITS.MAX_NOTE_PLAINTEXT_BYTES);
      const content = (n) => ({ nonce: b64(24), ciphertext: 'A'.repeat(n) });

      const ok = await alice.req(
        'POST',
        '/api/notes',
        noteBody({ encryptedContent: content(max) }),
      );
      const tooLong = await alice.req(
        'POST',
        '/api/notes',
        noteBody({ encryptedContent: content(max + 1) }),
      );

      expect(ok.statusCode).toBe(201);
      expect(tooLong.statusCode).toBe(400);
    });

    test('request vượt giới hạn 1 MB bị chặn với 413', async () => {
      const res = await alice.req(
        'POST',
        '/api/notes',
        noteBody({
          encryptedContent: {
            nonce: b64(24),
            ciphertext: 'A'.repeat(LIMITS.MAX_REQUEST_BYTES + 1),
          },
        }),
      );
      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe('PAYLOAD_TOO_LARGE');
    });

    test('từ chối request từ Origin lạ (CSRF)', async () => {
      const res = await alice.req('POST', '/api/notes', noteBody(), {
        headers: { origin: 'https://evil.example' },
      });
      expect(res.statusCode).toBe(403);
      expect((await alice.req('GET', '/api/notes')).json()).toEqual([]);
    });
  });

  describe('GET /api/notes', () => {
    test('trả note của mình, mới sửa nhất đứng đầu, không kèm nội dung', async () => {
      const first = await createNote(alice);
      await tick();
      const second = await createNote(alice);
      await tick();
      await alice.req('PUT', `/api/notes/${first.id}`, updateBody(2));

      const res = await alice.req('GET', '/api/notes');
      const list = res.json();

      expect(list.map((n) => n.id)).toEqual([first.id, second.id]);
      for (const item of list) expect(Object.keys(item).sort()).toEqual(NOTE_LIST_KEYS);
      expect(res.body).not.toContain(second.encryptedContent.ciphertext);
    });

    test('danh sách có khóa note đã bọc để client mở được tiêu đề', async () => {
      const body = await createNote(alice);
      const [item] = (await alice.req('GET', '/api/notes')).json();
      expect(item.wrappedNoteKey).toEqual(body.wrappedNoteKey);
      expect(item.encryptedTitle).toEqual(body.encryptedTitle);
    });

    test('người dùng chưa có note nào nhận mảng rỗng', async () => {
      const res = await alice.req('GET', '/api/notes');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    test('note được chia sẻ tới mình không nằm trong danh sách note của mình', async () => {
      const note = await createNote(alice);
      await shareTo(alice, note.id, bob);
      expect((await bob.req('GET', '/api/notes')).json()).toEqual([]);
    });
  });

  describe('GET /api/notes/:id', () => {
    test('chủ note nhận wrappedNoteKey và không có share', async () => {
      const note = await createNote(alice);
      const res = await getNote(alice, note.id);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: note.id,
        version: 1,
        encryptedTitle: note.encryptedTitle,
        encryptedContent: note.encryptedContent,
        wrappedNoteKey: note.wrappedNoteKey,
      });
      expect(res.json()).not.toHaveProperty('share');
    });

    test('người không liên quan nhận NOT_FOUND, giống hệt khi note không tồn tại (D30)', async () => {
      const note = await createNote(alice);
      const notYours = await getNote(bob, note.id);
      const nonexistent = await getNote(bob, crypto.randomUUID());

      expect(notYours.statusCode).toBe(404);
      expect(notYours.statusCode).toBe(nonexistent.statusCode);
      expect(notYours.json()).toEqual(nonexistent.json());
      expect(notYours.json().code).toBe('NOT_FOUND');
    });

    test('người được chia sẻ nhận share và KHÔNG nhận wrappedNoteKey của chủ', async () => {
      const note = await createNote(alice);
      const pkg = sharePackage();
      await shareTo(alice, note.id, bob, pkg);

      const res = await getNote(bob, note.id);

      expect(res.statusCode).toBe(200);
      expect(res.json().share).toEqual({ senderEmail: 'alice@example.com', sharePackage: pkg });
      expect(res.json()).not.toHaveProperty('wrappedNoteKey');
      expect(res.json().encryptedContent).toEqual(note.encryptedContent);
      expect(res.body).not.toContain(note.wrappedNoteKey.ciphertext);
    });

    test('xóa gói chia sẻ thì người nhận không đọc được nữa', async () => {
      const note = await createNote(alice);
      const shareId = await shareTo(alice, note.id, bob);
      expect((await getNote(bob, note.id)).statusCode).toBe(200);

      await alice.req('DELETE', `/api/shares/${shareId}`);

      expect((await getNote(bob, note.id)).statusCode).toBe(404);
    });

    test('người thứ ba không đọc được note đã chia sẻ cho người khác', async () => {
      const eve = await h.signUp('eve@example.com');
      const note = await createNote(alice);
      await shareTo(alice, note.id, bob);
      expect((await getNote(eve, note.id)).statusCode).toBe(404);
    });

    test('id sai định dạng bị từ chối', async () => {
      const res = await getNote(alice, 'khong-phai-uuid');
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/notes/:id', () => {
    test('chủ note sửa thành công: version tăng, nội dung đổi, khóa note giữ nguyên', async () => {
      const note = await createNote(alice);
      const update = updateBody(2);

      const res = await alice.req('PUT', `/api/notes/${note.id}`, update);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: note.id, version: 2 });
      const stored = (await getNote(alice, note.id)).json();
      expect(stored.version).toBe(2);
      expect(stored.encryptedContent).toEqual(update.encryptedContent);
      expect(stored.encryptedTitle).toEqual(update.encryptedTitle);
      expect(stored.wrappedNoteKey).toEqual(note.wrappedNoteKey);
    });

    test('sửa liên tiếp v2 rồi v3 đều thành công', async () => {
      const note = await createNote(alice);
      expect((await alice.req('PUT', `/api/notes/${note.id}`, updateBody(2))).statusCode).toBe(200);
      const res = await alice.req('PUT', `/api/notes/${note.id}`, updateBody(3));
      expect(res.statusCode).toBe(200);
      expect(res.json().version).toBe(3);
    });

    test('nhảy cóc version trả 409 VERSION_CONFLICT và không đổi gì', async () => {
      const note = await createNote(alice);
      const res = await alice.req('PUT', `/api/notes/${note.id}`, updateBody(3));

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('VERSION_CONFLICT');
      const stored = (await getNote(alice, note.id)).json();
      expect(stored.version).toBe(1);
      expect(stored.encryptedContent).toEqual(note.encryptedContent);
    });

    test('gửi lại version cũ (bản sửa lỗi thời) bị từ chối', async () => {
      const note = await createNote(alice);
      await alice.req('PUT', `/api/notes/${note.id}`, updateBody(2));
      const stale = await alice.req('PUT', `/api/notes/${note.id}`, updateBody(2));
      expect(stale.statusCode).toBe(409);
      expect(stale.json().code).toBe('VERSION_CONFLICT');
    });

    test('version 1 (hoặc thấp hơn) bị schema từ chối', async () => {
      const note = await createNote(alice);
      expect((await alice.req('PUT', `/api/notes/${note.id}`, updateBody(1))).statusCode).toBe(400);
      expect((await alice.req('PUT', `/api/notes/${note.id}`, updateBody(0))).statusCode).toBe(400);
    });

    test('hai thiết bị cùng sửa từ một version: đúng một bên thắng', async () => {
      const note = await createNote(alice);
      const laptop = await alice.req('PUT', `/api/notes/${note.id}`, updateBody(2));
      const phone = await alice.req('PUT', `/api/notes/${note.id}`, updateBody(2));
      const raced = await Promise.all([
        alice.req('PUT', `/api/notes/${note.id}`, updateBody(3)),
        alice.req('PUT', `/api/notes/${note.id}`, updateBody(3)),
      ]);

      expect(laptop.statusCode).toBe(200);
      expect(phone.statusCode).toBe(409);
      expect(raced.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect((await getNote(alice, note.id)).json().version).toBe(3);
    });

    test('người không phải chủ nhận NOT_FOUND và note không bị đổi', async () => {
      const note = await createNote(alice);
      const res = await bob.req('PUT', `/api/notes/${note.id}`, updateBody(2));

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
      expect((await getNote(alice, note.id)).json().version).toBe(1);
    });

    test('người được chia sẻ cũng không sửa được', async () => {
      const note = await createNote(alice);
      await shareTo(alice, note.id, bob);

      const res = await bob.req('PUT', `/api/notes/${note.id}`, updateBody(2));

      expect(res.statusCode).toBe(404);
      const stored = (await getNote(alice, note.id)).json();
      expect(stored.version).toBe(1);
      expect(stored.encryptedContent).toEqual(note.encryptedContent);
    });

    test('note không tồn tại trả NOT_FOUND', async () => {
      const res = await alice.req('PUT', `/api/notes/${crypto.randomUUID()}`, updateBody(2));
      expect(res.statusCode).toBe(404);
    });

    test('không sửa được khóa note hay chủ note qua PUT (trường lạ bị từ chối)', async () => {
      const note = await createNote(alice);
      const withKey = await alice.req(
        'PUT',
        `/api/notes/${note.id}`,
        updateBody(2, { wrappedNoteKey: sealed() }),
      );
      const withOwner = await alice.req(
        'PUT',
        `/api/notes/${note.id}`,
        updateBody(2, { ownerId: 'x' }),
      );
      expect(withKey.statusCode).toBe(400);
      expect(withOwner.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/notes/:id', () => {
    test('chủ note xóa được: trả 204, note biến mất khỏi danh sách và khi đọc', async () => {
      const note = await createNote(alice);
      const res = await alice.req('DELETE', `/api/notes/${note.id}`);

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect((await getNote(alice, note.id)).statusCode).toBe(404);
      expect((await alice.req('GET', '/api/notes')).json()).toEqual([]);
    });

    test('xóa lần hai trả NOT_FOUND', async () => {
      const note = await createNote(alice);
      await alice.req('DELETE', `/api/notes/${note.id}`);
      expect((await alice.req('DELETE', `/api/notes/${note.id}`)).statusCode).toBe(404);
    });

    test('người không phải chủ không xóa được, note vẫn còn', async () => {
      const note = await createNote(alice);
      const res = await bob.req('DELETE', `/api/notes/${note.id}`);

      expect(res.statusCode).toBe(404);
      expect((await getNote(alice, note.id)).statusCode).toBe(200);
    });

    test('người được chia sẻ cũng không xóa được', async () => {
      const note = await createNote(alice);
      await shareTo(alice, note.id, bob);
      expect((await bob.req('DELETE', `/api/notes/${note.id}`)).statusCode).toBe(404);
      expect((await getNote(alice, note.id)).statusCode).toBe(200);
    });

    test('xóa note kéo theo xóa các gói chia sẻ của nó', async () => {
      const note = await createNote(alice);
      await shareTo(alice, note.id, bob);
      expect((await bob.req('GET', '/api/shares')).json()).toHaveLength(1);

      await alice.req('DELETE', `/api/notes/${note.id}`);

      expect((await bob.req('GET', '/api/shares')).json()).toEqual([]);
      expect((await getNote(bob, note.id)).statusCode).toBe(404);
    });
  });

  describe('POST /api/notes/:id/rotate (thu hồi quyền, D24)', () => {
    let carol;
    let note;

    beforeEach(async () => {
      carol = await h.signUp('carol@example.com');
      note = await createNote(alice);
      await shareTo(alice, note.id, bob);
      await shareTo(alice, note.id, carol);
    });

    test('giữ Bob, thu hồi Carol: Bob nhận gói mới, Carol mất quyền, chủ có khóa mới', async () => {
      const rotate = rotateBody(2, ['bob@example.com']);
      const res = await alice.req('POST', `/api/notes/${note.id}/rotate`, rotate);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ id: note.id, version: 2 });

      const forBob = (await getNote(bob, note.id)).json();
      expect(forBob.version).toBe(2);
      expect(forBob.encryptedContent).toEqual(rotate.encryptedContent);
      expect(forBob.share.sharePackage).toEqual(rotate.shares[0].sharePackage);

      expect((await getNote(carol, note.id)).statusCode).toBe(404);
      expect((await carol.req('GET', '/api/shares')).json()).toEqual([]);

      const forAlice = (await getNote(alice, note.id)).json();
      expect(forAlice.wrappedNoteKey).toEqual(rotate.wrappedNoteKey);
      expect(forAlice.wrappedNoteKey).not.toEqual(note.wrappedNoteKey);
    });

    test('danh sách rỗng thu hồi quyền của tất cả mọi người', async () => {
      const res = await alice.req('POST', `/api/notes/${note.id}/rotate`, rotateBody(2, []));

      expect(res.statusCode).toBe(200);
      expect((await getNote(bob, note.id)).statusCode).toBe(404);
      expect((await getNote(carol, note.id)).statusCode).toBe(404);
      expect((await getNote(alice, note.id)).statusCode).toBe(200);
    });

    test('email khác hoa/thường và khoảng trắng vẫn khớp đúng người', async () => {
      const res = await alice.req(
        'POST',
        `/api/notes/${note.id}/rotate`,
        rotateBody(2, [' BOB@Example.COM ']),
      );
      expect(res.statusCode).toBe(200);
      expect((await getNote(bob, note.id)).statusCode).toBe(200);
      expect((await getNote(carol, note.id)).statusCode).toBe(404);
    });

    test('version sai trả 409 và KHÔNG thu hồi ai, không đổi khóa', async () => {
      const res = await alice.req(
        'POST',
        `/api/notes/${note.id}/rotate`,
        rotateBody(5, ['bob@example.com']),
      );

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('VERSION_CONFLICT');
      expect((await getNote(carol, note.id)).statusCode).toBe(200);
      expect((await getNote(alice, note.id)).json().wrappedNoteKey).toEqual(note.wrappedNoteKey);
    });

    test('một người nhận không tồn tại thì cả thao tác bị hủy (transaction rollback)', async () => {
      const before = (await getNote(bob, note.id)).json();

      const res = await alice.req(
        'POST',
        `/api/notes/${note.id}/rotate`,
        rotateBody(2, ['bob@example.com', 'khong-co@example.com']),
      );

      expect(res.statusCode).toBe(404);
      // Không có gì thay đổi dù khóa mới đã được ghi trước khi phát hiện lỗi.
      const forAlice = (await getNote(alice, note.id)).json();
      expect(forAlice.version).toBe(1);
      expect(forAlice.wrappedNoteKey).toEqual(note.wrappedNoteKey);
      expect((await getNote(bob, note.id)).json()).toEqual(before);
      expect((await getNote(carol, note.id)).statusCode).toBe(200);
    });

    test('không thể có chính mình trong danh sách người nhận, và không đổi gì', async () => {
      const res = await alice.req(
        'POST',
        `/api/notes/${note.id}/rotate`,
        rotateBody(2, ['alice@example.com']),
      );
      expect(res.statusCode).toBe(400);
      expect((await getNote(alice, note.id)).json().version).toBe(1);
      expect((await getNote(bob, note.id)).statusCode).toBe(200);
    });

    test('email lặp trong danh sách bị từ chối, kể cả khác hoa/thường', async () => {
      const res = await alice.req(
        'POST',
        `/api/notes/${note.id}/rotate`,
        rotateBody(2, ['bob@example.com', 'BOB@example.com']),
      );
      expect(res.statusCode).toBe(400);
      expect((await getNote(alice, note.id)).json().version).toBe(1);
    });

    test('danh sách vượt số người nhận tối đa bị từ chối', async () => {
      const emails = Array.from({ length: LIMITS.MAX_ROTATE_SHARES + 1 }, (_, i) => `u${i}@x.com`);
      const res = await alice.req('POST', `/api/notes/${note.id}/rotate`, rotateBody(2, emails));
      expect(res.statusCode).toBe(400);
    });

    test('người không phải chủ (kể cả người đang được chia sẻ) không xoay khóa được', async () => {
      for (const user of [bob, carol]) {
        const res = await user.req(
          'POST',
          `/api/notes/${note.id}/rotate`,
          rotateBody(2, [
            user.email === 'bob@example.com' ? 'carol@example.com' : 'bob@example.com',
          ]),
        );
        expect(res.statusCode).toBe(404);
      }
      const stored = (await getNote(alice, note.id)).json();
      expect(stored.version).toBe(1);
      expect(stored.wrappedNoteKey).toEqual(note.wrappedNoteKey);
      expect((await getNote(bob, note.id)).statusCode).toBe(200);
      expect((await getNote(carol, note.id)).statusCode).toBe(200);
    });

    test('note không tồn tại trả NOT_FOUND', async () => {
      const res = await alice.req(
        'POST',
        `/api/notes/${crypto.randomUUID()}/rotate`,
        rotateBody(2, []),
      );
      expect(res.statusCode).toBe(404);
    });
  });
});

/**
 * Mọi route cần đăng nhập phải từ chối request không có phiên. Kiểm tra theo bảng để route nào
 * thêm sau mà quên gắn `app.authenticate` thì bảng này nhắc (thêm dòng vào đây khi thêm route).
 */
describe.each(backends)('route cần đăng nhập [$name]', (backend) => {
  let h;

  beforeEach(async () => {
    h = await createHarness(await backend.create());
  });

  afterEach(() => h.close());

  const id = '3f2b8c1e-7a4d-4e6f-9b1a-2c5d8e0f4a6b';
  const routes = [
    ['GET', '/api/me'],
    ['POST', '/api/logout'],
    ['POST', '/api/change-password'],
    ['POST', '/api/notes'],
    ['GET', '/api/notes'],
    ['GET', `/api/notes/${id}`],
    ['PUT', `/api/notes/${id}`],
    ['DELETE', `/api/notes/${id}`],
    ['POST', `/api/notes/${id}/rotate`],
    ['POST', `/api/notes/${id}/shares`],
    ['GET', `/api/notes/${id}/shares`],
    ['GET', '/api/shares'],
    ['DELETE', `/api/shares/${id}`],
    ['GET', '/api/users/bob%40example.com/keys'],
  ];

  test.each(routes)('%s %s không có cookie trả 401 UNAUTHENTICATED', async (method, url) => {
    // Body rỗng: xác thực phải chạy TRƯỚC khi kiểm tra body, nên vẫn ra 401 chứ không phải 400.
    const res = await h.send(method, url);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  test.each(routes)('%s %s với cookie rác cũng trả 401', async (method, url) => {
    const res = await h.send(method, url, { token: 'khong-phai-token-that' });
    expect(res.statusCode).toBe(401);
  });
});
