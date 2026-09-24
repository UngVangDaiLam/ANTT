import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ApiError } from '@secure-notes/client-sdk';
import { fromBase64, note as noteCrypto, sharing } from '@secure-notes/crypto';
import { backends, createUser, startServer } from './helpers/stack.js';

/**
 * Sửa, xóa, gỡ chia sẻ và thu hồi quyền (xoay khóa): client-sdk thật gọi server thật. SDK tự tính
 * payload (mã hóa lại, gói chia sẻ mới cho người ở lại) còn server thi hành version, quyền và
 * transaction — chỉ khi hai bên chạy cùng nhau mới biết thao tác có thật sự đúng không.
 */
describe.each(backends)('vòng đời note [$name]', (backend) => {
  let server;
  let alice;
  let bob;
  let carol;

  beforeEach(async () => {
    server = await startServer(await backend.create());
    alice = createUser(server.baseUrl);
    bob = createUser(server.baseUrl);
    carol = createUser(server.baseUrl);
    await alice.client.register('alice@example.com', 'mk-alice-dai');
    await bob.client.register('bob@example.com', 'mk-bob-dai');
    await carol.client.register('carol@example.com', 'mk-carol-dai');
  });

  afterEach(() => server.close());

  async function sharedNote(recipients) {
    const { id } = await alice.client.createNote({ title: 'Kế hoạch', content: 'Nội dung gốc' });
    for (const email of recipients) await alice.client.shareNote(id, email);
    return id;
  }

  test('sửa note: người được chia sẻ đọc được bản mới; bản sửa lỗi thời bị server từ chối', async () => {
    const id = await sharedNote(['bob@example.com']);
    const phone = createUser(server.baseUrl);
    await phone.client.login('alice@example.com', 'mk-alice-dai');
    const onPhone = await phone.client.readNote(id);

    await alice.client.updateNote(id, { title: 'v2', content: 'Bản mới', version: 1 });

    expect(await bob.client.readNote(id)).toMatchObject({ title: 'v2', content: 'Bản mới' });
    const late = phone.client.updateNote(id, {
      title: 'Từ điện thoại',
      content: 'Ghi đè?',
      version: onPhone.version,
    });
    await expect(late).rejects.toBeInstanceOf(ApiError);
    await expect(late).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await alice.client.readNote(id)).content).toBe('Bản mới');
  });

  test('sửa note: người được chia sẻ bị chặn', async () => {
    const id = await sharedNote(['bob@example.com']);
    await expect(
      bob.client.updateNote(id, { title: 'Hack', content: 'Bị sửa', version: 1 }),
    ).rejects.toThrow('không phải chủ');
    expect((await alice.client.readNote(id)).content).toBe('Nội dung gốc');
  });

  test('xóa note: mất với mọi người; người khác không xóa được', async () => {
    const id = await sharedNote(['bob@example.com']);
    await expect(bob.client.deleteNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await alice.client.deleteNote(id);

    expect(await alice.client.listNotes()).toEqual([]);
    await expect(bob.client.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await bob.client.listSharedWithMe()).toEqual([]);
  });

  test('danh sách người nhận và gỡ chia sẻ', async () => {
    const id = await sharedNote(['bob@example.com', 'carol@example.com']);
    const list = await alice.client.listNoteShares(id);
    expect(list.map((s) => s.recipientEmail)).toEqual(['bob@example.com', 'carol@example.com']);
    await expect(bob.client.listNoteShares(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const toBob = list.find((s) => s.recipientEmail === 'bob@example.com');
    await expect(bob.client.unshareNote(toBob.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await alice.client.unshareNote(toBob.id);

    await expect(bob.client.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await carol.client.readNote(id)).content).toBe('Nội dung gốc');
  });

  test('thu hồi quyền: Bob mất quyền, khóa cũ của Bob không mở được nội dung mới, Carol vẫn đọc được', async () => {
    const id = await sharedNote(['bob@example.com', 'carol@example.com']);
    // Bob đã mở note, nên có thể đã giữ lại gói chia sẻ cũ: bắt lấy đúng response server gửi Bob.
    let bobsOldPackage;
    bob.browser.intercept(async ({ method, path, response }) => {
      if (method === 'GET' && path === `/api/notes/${id}`) {
        bobsOldPackage = (await response.clone().json()).share.sharePackage;
      }
    });
    expect((await bob.client.readNote(id)).content).toBe('Nội dung gốc');
    bob.browser.intercept(null);

    const res = await alice.client.revokeAccess(id, ['bob@example.com']);

    expect(res).toMatchObject({ id, version: 2, keptRecipients: ['carol@example.com'] });
    await expect(bob.client.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await carol.client.readNote(id)).content).toBe('Nội dung gốc');
    expect(await alice.client.readNote(id)).toMatchObject({ content: 'Nội dung gốc', version: 2 });

    // Ciphertext server đang giữ sau khi xoay khóa, lấy từ phía Carol.
    let current;
    carol.browser.intercept(async ({ method, path, response }) => {
      if (method === 'GET' && path === `/api/notes/${id}`) current = await response.clone().json();
    });
    await carol.client.readNote(id);

    const aliceKeys = await bob.client.transport.getUserKeys('alice@example.com');
    const oldKey = await sharing.unwrapNoteKeyFromSender(
      bobsOldPackage,
      bob.client._session.x25519PrivateKey,
      fromBase64(aliceKeys.ed25519PublicKey),
    );
    await expect(noteCrypto.decryptNote(current.encryptedContent, oldKey)).rejects.toThrow();
    await expect(noteCrypto.decryptNote(current.encryptedTitle, oldKey)).rejects.toThrow();
  });

  test('thu hồi quyền của email không được chia sẻ: báo lỗi, không đổi gì trên server', async () => {
    const id = await sharedNote(['bob@example.com']);
    const before = alice.browser.sent.length;

    await expect(alice.client.revokeAccess(id, ['carol@example.com'])).rejects.toThrow(
      'không được chia sẻ cho',
    );

    expect(alice.browser.sent.slice(before).map((r) => r.path)).not.toContain(
      `/api/notes/${id}/rotate`,
    );
    expect((await bob.client.readNote(id)).version).toBe(1);
  });
});
