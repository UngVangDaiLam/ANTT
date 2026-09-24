import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { RATE_LIMITS } from '@secure-notes/shared';
import { backends, tick } from './helpers/backends.js';
import { b64, noteBody, sharePackage } from './helpers/fixtures.js';
import { createHarness } from './helpers/harness.js';

const SHARE_LIST_KEYS = ['createdAt', 'id', 'noteId', 'senderEmail'];

describe.each(backends)('chia sẻ [$name]', (backend) => {
  let h;
  let alice;
  let bob;
  let note;

  beforeEach(async () => {
    h = await createHarness(await backend.create());
    alice = await h.signUp('alice@example.com');
    bob = await h.signUp('bob@example.com');
    note = noteBody();
    expect((await alice.req('POST', '/api/notes', note)).statusCode).toBe(201);
  });

  afterEach(() => h.close());

  const share = (user, noteId, recipientEmail, pkg = sharePackage()) =>
    user.req('POST', `/api/notes/${noteId}/shares`, { recipientEmail, sharePackage: pkg });

  describe('GET /api/users/:email/keys', () => {
    const keys = (user, email, extra) =>
      user.req('GET', `/api/users/${encodeURIComponent(email)}/keys`, undefined, extra);

    test('trả đúng hai khóa công khai của người đó và không gì khác', async () => {
      const res = await keys(alice, 'bob@example.com');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        x25519PublicKey: bob.body.x25519PublicKey,
        ed25519PublicKey: bob.body.ed25519PublicKey,
      });
    });

    test('email khác hoa/thường và khoảng trắng vẫn tra ra đúng người', async () => {
      const res = await keys(alice, ' BOB@Example.COM ');
      expect(res.statusCode).toBe(200);
      expect(res.json().x25519PublicKey).toBe(bob.body.x25519PublicKey);
    });

    test('email không tồn tại trả NOT_FOUND', async () => {
      const res = await keys(alice, 'khong-co@example.com');
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    });

    test('email sai định dạng bị từ chối', async () => {
      const res = await keys(alice, 'khong-phai-email');
      expect(res.statusCode).toBe(400);
    });

    test('vượt giới hạn tần suất trả 429 (chặn dò email hàng loạt)', async () => {
      const ip = '192.0.2.50';
      for (let i = 0; i < RATE_LIMITS.USER_KEYS.max; i++) {
        await keys(alice, 'bob@example.com', { ip });
      }
      const res = await keys(alice, 'bob@example.com', { ip });
      expect(res.statusCode).toBe(429);
      expect(res.json().code).toBe('RATE_LIMITED');
    });
  });

  describe('POST /api/notes/:id/shares', () => {
    test('chủ note chia sẻ được: 201 kèm id, người nhận thấy trong danh sách của mình', async () => {
      const res = await share(alice, note.id, 'bob@example.com');

      expect(res.statusCode).toBe(201);
      expect(Object.keys(res.json())).toEqual(['id']);
      const list = (await bob.req('GET', '/api/shares')).json();
      expect(list.map((s) => s.id)).toEqual([res.json().id]);
      expect(list[0]).toMatchObject({ noteId: note.id, senderEmail: 'alice@example.com' });
    });

    test('người gửi lấy từ phiên: không nhận senderEmail từ body (D16)', async () => {
      const res = await alice.req('POST', `/api/notes/${note.id}/shares`, {
        recipientEmail: 'bob@example.com',
        sharePackage: sharePackage(),
        senderEmail: 'eve@example.com',
      });
      expect(res.statusCode).toBe(400);
      expect((await bob.req('GET', '/api/shares')).json()).toEqual([]);
    });

    test('email người nhận khác hoa/thường và khoảng trắng vẫn tới đúng người', async () => {
      const res = await share(alice, note.id, ' BOB@Example.COM ');
      expect(res.statusCode).toBe(201);
      expect((await bob.req('GET', '/api/shares')).json()).toHaveLength(1);
    });

    test('người không phải chủ note nhận NOT_FOUND và không tạo được share nào', async () => {
      const eve = await h.signUp('eve@example.com');
      const res = await share(bob, note.id, 'eve@example.com');

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
      expect((await eve.req('GET', '/api/shares')).json()).toEqual([]);
    });

    test('người đang được chia sẻ cũng không chia sẻ tiếp được', async () => {
      const eve = await h.signUp('eve@example.com');
      await share(alice, note.id, 'bob@example.com');

      const res = await share(bob, note.id, 'eve@example.com');

      expect(res.statusCode).toBe(404);
      expect((await eve.req('GET', '/api/shares')).json()).toEqual([]);
    });

    test('note của người khác và note không tồn tại cho ra cùng một response (D30)', async () => {
      const notYours = await share(bob, note.id, 'alice@example.com');
      const nonexistent = await share(bob, crypto.randomUUID(), 'alice@example.com');

      expect(notYours.statusCode).toBe(nonexistent.statusCode);
      expect(notYours.json()).toEqual(nonexistent.json());
    });

    test('người nhận không tồn tại trả NOT_FOUND', async () => {
      const res = await share(alice, note.id, 'khong-co@example.com');
      expect(res.statusCode).toBe(404);
    });

    test('không thể chia sẻ cho chính mình', async () => {
      const res = await share(alice, note.id, 'alice@example.com');
      expect(res.statusCode).toBe(400);
      expect((await alice.req('GET', '/api/shares')).json()).toEqual([]);
    });

    test('chia sẻ lại cho cùng người là THAY gói cũ: giữ nguyên id, không nhân đôi bản ghi', async () => {
      const first = await share(alice, note.id, 'bob@example.com');
      const newer = sharePackage();
      const second = await share(alice, note.id, 'bob@example.com', newer);

      expect(second.statusCode).toBe(201);
      expect(second.json().id).toBe(first.json().id);
      expect((await bob.req('GET', '/api/shares')).json()).toHaveLength(1);
      const read = (await bob.req('GET', `/api/notes/${note.id}`)).json();
      expect(read.share.sharePackage).toEqual(newer);
    });

    test.each([
      ['chữ ký sai độ dài', (p) => ({ ...p, signature: b64(32) })],
      ['khóa ephemeral sai độ dài', (p) => ({ ...p, ephemeralPublicKey: b64(16) })],
      ['nonce sai độ dài', (p) => ({ ...p, nonce: b64(12) })],
      ['thiếu chữ ký', ({ signature: _s, ...rest }) => rest],
      ['thừa trường', (p) => ({ ...p, extra: 'x' })],
    ])('gói chia sẻ có %s bị từ chối', async (_name, mutate) => {
      const res = await share(alice, note.id, 'bob@example.com', mutate(sharePackage()));
      expect(res.statusCode).toBe(400);
      expect((await bob.req('GET', '/api/shares')).json()).toEqual([]);
    });

    test('id note sai định dạng bị từ chối', async () => {
      const res = await share(alice, 'khong-phai-uuid', 'bob@example.com');
      expect(res.statusCode).toBe(400);
    });

    test('từ chối request từ Origin lạ (CSRF)', async () => {
      const res = await alice.req(
        'POST',
        `/api/notes/${note.id}/shares`,
        { recipientEmail: 'bob@example.com', sharePackage: sharePackage() },
        { headers: { origin: 'https://evil.example' } },
      );
      expect(res.statusCode).toBe(403);
      expect((await bob.req('GET', '/api/shares')).json()).toEqual([]);
    });
  });

  describe('GET /api/shares', () => {
    test('chỉ trả tham chiếu tối thiểu: không có gói chia sẻ, không có ciphertext', async () => {
      const pkg = sharePackage();
      await share(alice, note.id, 'bob@example.com', pkg);

      const res = await bob.req('GET', '/api/shares');

      expect(Object.keys(res.json()[0]).sort()).toEqual(SHARE_LIST_KEYS);
      expect(res.body).not.toContain(pkg.ciphertext);
      expect(res.body).not.toContain(note.encryptedContent.ciphertext);
    });

    test('người gửi không thấy các share mình đã gửi trong danh sách của mình', async () => {
      await share(alice, note.id, 'bob@example.com');
      expect((await alice.req('GET', '/api/shares')).json()).toEqual([]);
    });

    test('mỗi người chỉ thấy share gửi cho chính mình', async () => {
      const eve = await h.signUp('eve@example.com');
      await share(alice, note.id, 'bob@example.com');

      expect((await bob.req('GET', '/api/shares')).json()).toHaveLength(1);
      expect((await eve.req('GET', '/api/shares')).json()).toEqual([]);
    });

    test('mới nhất đứng đầu, gộp được từ nhiều người gửi', async () => {
      const second = noteBody();
      await bob.req('POST', '/api/notes', second);
      await share(alice, note.id, 'bob@example.com').then(() => tick());
      // Eve nhận từ hai người gửi khác nhau (Alice rồi Bob) để kiểm tra thứ tự và gộp nguồn.
      const eve = await h.signUp('eve@example.com');
      await share(alice, note.id, 'eve@example.com');
      await tick();
      await bob.req('POST', `/api/notes/${second.id}/shares`, {
        recipientEmail: 'eve@example.com',
        sharePackage: sharePackage(),
      });

      const list = (await eve.req('GET', '/api/shares')).json();

      expect(list.map((s) => [s.noteId, s.senderEmail])).toEqual([
        [second.id, 'bob@example.com'],
        [note.id, 'alice@example.com'],
      ]);
    });

    test('createdAt là ISO-8601', async () => {
      await share(alice, note.id, 'bob@example.com');
      const [item] = (await bob.req('GET', '/api/shares')).json();
      expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
    });
  });

  describe('DELETE /api/shares/:id', () => {
    let shareId;

    beforeEach(async () => {
      shareId = (await share(alice, note.id, 'bob@example.com')).json().id;
    });

    test('người gửi xóa được: 204 và người nhận mất quyền đọc note', async () => {
      const res = await alice.req('DELETE', `/api/shares/${shareId}`);

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect((await bob.req('GET', '/api/shares')).json()).toEqual([]);
      expect((await bob.req('GET', `/api/notes/${note.id}`)).statusCode).toBe(404);
    });

    test('người nhận không tự xóa được (chỉ người gửi), share vẫn còn', async () => {
      const res = await bob.req('DELETE', `/api/shares/${shareId}`);

      expect(res.statusCode).toBe(404);
      expect((await bob.req('GET', '/api/shares')).json()).toHaveLength(1);
    });

    test('người không liên quan không xóa được', async () => {
      const eve = await h.signUp('eve@example.com');
      const res = await eve.req('DELETE', `/api/shares/${shareId}`);
      expect(res.statusCode).toBe(404);
      expect((await bob.req('GET', `/api/notes/${note.id}`)).statusCode).toBe(200);
    });

    test('xóa lần hai và xóa id không tồn tại đều trả NOT_FOUND như nhau', async () => {
      await alice.req('DELETE', `/api/shares/${shareId}`);
      const again = await alice.req('DELETE', `/api/shares/${shareId}`);
      const nonexistent = await alice.req('DELETE', `/api/shares/${crypto.randomUUID()}`);

      expect(again.statusCode).toBe(404);
      expect(again.json()).toEqual(nonexistent.json());
    });

    test('id sai định dạng bị từ chối', async () => {
      const res = await alice.req('DELETE', '/api/shares/khong-phai-uuid');
      expect(res.statusCode).toBe(400);
    });

    test('từ chối request từ Origin lạ (CSRF), share vẫn còn', async () => {
      const res = await alice.req('DELETE', `/api/shares/${shareId}`, undefined, {
        headers: { origin: 'https://evil.example' },
      });
      expect(res.statusCode).toBe(403);
      expect((await bob.req('GET', '/api/shares')).json()).toHaveLength(1);
    });
  });
});
