import { beforeEach, describe, test, expect, vi } from 'vitest';
import { fromBase64, getSodium, note as noteCrypto, sharing } from '@secure-notes/crypto';
import { KDF_DEFAULTS, LIMITS } from '@secure-notes/shared';
import { SecureNoteClient } from '../src/client.js';
import { createMemoryServer, createMemoryTransport } from '../src/memoryTransport.js';
import { ApiError } from '../src/apiError.js';
import { createLocalStorageVersionStore } from '../src/versionStore.js';

/** Một người dùng = một trình duyệt = một kết nối riêng tới server giả. */
function newClient(server) {
  return new SecureNoteClient(server.connect());
}

describe('SecureNoteClient (giống hệt cách giao diện web sẽ dùng)', () => {
  test('đăng ký, tạo note, tự đọc lại note của chính mình', async () => {
    const alice = newClient(createMemoryServer());
    await alice.register('alice@example.com', 'mat-khau-cua-alice');

    const { id } = await alice.createNote({
      title: 'Bí mật',
      content: 'Ghi chú bí mật của Alice',
    });
    const note = await alice.readNote(id);

    expect(note.title).toBe('Bí mật');
    expect(note.content).toBe('Ghi chú bí mật của Alice');
    expect(note.version).toBe(1);
    expect(note.sharedBy).toBeNull();
  });

  test('danh sách note trả tiêu đề đã giải mã và KHÔNG kèm nội dung', async () => {
    const alice = newClient(createMemoryServer());
    await alice.register('alice-list@example.com', 'mk-du-dai-hon');
    await alice.createNote({ title: 'Việc cần làm', content: 'Nội dung không được lộ ở đây' });

    const list = await alice.listNotes();

    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Việc cần làm');
    expect(Object.keys(list[0])).toEqual(['id', 'version', 'title', 'updatedAt']);
  });

  test('đăng xuất rồi đăng nhập lại vẫn đọc được note cũ', async () => {
    const server = createMemoryServer();
    const alice1 = newClient(server);
    await alice1.register('alice2@example.com', 'mat-khau-cua-alice');
    const { id } = await alice1.createNote({ title: 'Cần nhớ', content: 'Note cần nhớ' });
    await alice1.logout();
    expect(alice1.isLoggedIn()).toBe(false);

    const alice2 = newClient(server);
    await alice2.login('alice2@example.com', 'mat-khau-cua-alice');

    expect((await alice2.readNote(id)).content).toBe('Note cần nhớ');
  });

  test('sai mật khẩu thì đăng nhập phải thất bại', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    await alice.register('alice3@example.com', 'mat-khau-dung');
    await alice.logout();

    const attacker = newClient(server);
    await expect(attacker.login('alice3@example.com', 'mat-khau-sai')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  test('đăng ký trùng email bị từ chối (D35)', async () => {
    const server = createMemoryServer();
    await newClient(server).register('trung@example.com', 'mk-1-dai-hon');

    await expect(
      newClient(server).register('TRUNG@example.com', 'mk-2-dai-hon'),
    ).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });

  test('chia sẻ một note cho Bob, Bob đọc được đúng nội dung', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    const bob = newClient(server);
    await alice.register('alice4@example.com', 'mk-alice');
    await bob.register('bob4@example.com', 'mk-bob-dai');

    const { id } = await alice.createNote({ title: 'Mua sắm', content: 'Danh sách mua sắm' });
    await alice.shareNote(id, 'bob4@example.com');

    const shared = await bob.listSharedWithMe();
    expect(shared).toHaveLength(1);
    expect(shared[0].noteId).toBe(id);

    // D22: Bob đọc chính note gốc qua noteId, server không sao chép ciphertext.
    const note = await bob.readNote(id);
    expect(note.content).toBe('Danh sách mua sắm');
    expect(note.sharedBy).toBe('alice4@example.com');
  });

  test('Bob KHÔNG đọc được note không được chia sẻ, và nhận NOT_FOUND chứ không phải FORBIDDEN (D30)', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    const bob = newClient(server);
    await alice.register('alice5@example.com', 'mk-alice');
    await bob.register('bob5@example.com', 'mk-bob-dai');

    const biMat = await alice.createNote({ title: 'Tuyệt mật', content: 'Không chia sẻ' });

    await expect(bob.readNote(biMat.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await bob.listSharedWithMe()).toHaveLength(0);
  });

  test('người thứ ba không đọc được note đã chia sẻ cho người khác', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    const bob = newClient(server);
    const eve = newClient(server);
    await alice.register('alice6@example.com', 'mk-alice');
    await bob.register('bob6@example.com', 'mk-bob-dai');
    await eve.register('eve6@example.com', 'mk-eve-dai');

    const { id } = await alice.createNote({ title: 'Riêng Bob', content: 'Chỉ dành cho Bob' });
    await alice.shareNote(id, 'bob6@example.com');

    await expect(eve.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('không thể chia sẻ note của người khác', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    const eve = newClient(server);
    await alice.register('alice14@example.com', 'mk-alice');
    await eve.register('eve14@example.com', 'mk-eve-dai');

    const { id } = await alice.createNote({ title: 'Của Alice', content: 'Của riêng Alice' });

    await expect(eve.shareNote(id, 'eve14@example.com')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('fingerprint của cùng một người là như nhau dù ai tra cứu', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    const bob = newClient(server);
    await alice.register('alice7@example.com', 'mk-alice');
    await bob.register('bob7@example.com', 'mk-bob-dai');

    const fp1 = await alice.getFingerprint('bob7@example.com');
    const fp2 = await bob.getFingerprint('bob7@example.com');

    expect(fp1.x25519Fingerprint).toBe(fp2.x25519Fingerprint);
    expect(fp1.ed25519Fingerprint).toBe(fp2.ed25519Fingerprint);
    // Hai cặp khóa tách biệt nhau thì fingerprint cũng phải khác nhau.
    expect(fp1.x25519Fingerprint).not.toBe(fp1.ed25519Fingerprint);
  });

  test('gọi hàm cần đăng nhập khi chưa đăng nhập thì báo lỗi rõ ràng', async () => {
    const client = new SecureNoteClient(createMemoryTransport());
    await expect(client.createNote({ title: 'a', content: 'b' })).rejects.toThrow('Chưa đăng nhập');
  });

  test('đổi mật khẩu xong, đăng nhập bằng mật khẩu mới vẫn đọc được note cũ', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    await alice.register('alice8@example.com', 'mat-khau-cu');
    const { id } = await alice.createNote({ title: 'Trước', content: 'Ghi chú trước khi đổi' });

    await alice.changePassword('mat-khau-cu', 'mat-khau-moi');
    await alice.logout();

    const alice2 = newClient(server);
    await alice2.login('alice8@example.com', 'mat-khau-moi');
    expect((await alice2.readNote(id)).content).toBe('Ghi chú trước khi đổi');
  });

  test('đổi mật khẩu xong, mật khẩu cũ không còn dùng được', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    await alice.register('alice9@example.com', 'mat-khau-cu');
    await alice.changePassword('mat-khau-cu', 'mat-khau-moi');
    await alice.logout();

    await expect(newClient(server).login('alice9@example.com', 'mat-khau-cu')).rejects.toThrow();
  });

  test('đổi mật khẩu với mật khẩu cũ sai thì bị từ chối và không đổi gì cả', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    await alice.register('alice10@example.com', 'mat-khau-dung');

    await expect(alice.changePassword('mat-khau-sai', 'mat-khau-moi')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    await alice.logout();
    const alice2 = newClient(server);
    await alice2.login('alice10@example.com', 'mat-khau-dung');
    expect(alice2.isLoggedIn()).toBe(true);
  });

  test('chia sẻ vẫn hoạt động sau khi đổi mật khẩu (private key được bọc lại đúng)', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    const bob = newClient(server);
    await alice.register('alice11@example.com', 'mat-khau-cu');
    await bob.register('bob11@example.com', 'mk-bob-dai');

    const { id } = await alice.createNote({ title: 'Sẽ chia sẻ', content: 'Nội dung chia sẻ' });
    await alice.changePassword('mat-khau-cu', 'mat-khau-moi');
    await alice.shareNote(id, 'bob11@example.com');

    expect((await bob.readNote(id)).content).toBe('Nội dung chia sẻ');
  });

  test('email không phân biệt hoa/thường và khoảng trắng hai đầu', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    await alice.register('  Alice12@Example.com  ', 'mat-khau-cua-alice');
    expect(alice.currentUserEmail()).toBe('alice12@example.com');
    await alice.logout();

    const alice2 = newClient(server);
    await alice2.login('ALICE12@EXAMPLE.COM', 'mat-khau-cua-alice');
    expect(alice2.isLoggedIn()).toBe(true);
  });

  test('logout() khi server báo phiên đã mất vẫn thành công và vẫn xóa khóa', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    await alice.register('alice18@example.com', 'mk-du-dai-hon');
    const masterKeyRef = alice._session.masterKey;
    // Phiên ở server đã bị hủy từ trước (hết hạn, hoặc đổi mật khẩu ở thiết bị khác).
    transport.logout = async () => {
      throw new ApiError('UNAUTHENTICATED', 'Bạn chưa đăng nhập hoặc phiên đã hết hạn.');
    };

    await expect(alice.logout()).resolves.toBeUndefined();
    expect(alice.isLoggedIn()).toBe(false);
    expect(masterKeyRef.every((byte) => byte === 0)).toBe(true);
  });

  test('logout() khi mất mạng: vẫn xóa khóa cục bộ nhưng báo lỗi để giao diện cảnh báo', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    await alice.register('alice19@example.com', 'mk-du-dai-hon');
    const masterKeyRef = alice._session.masterKey;
    transport.logout = async () => {
      throw new TypeError('Failed to fetch');
    };

    await expect(alice.logout()).rejects.toThrow('Failed to fetch');
    expect(alice.isLoggedIn()).toBe(false);
    expect(masterKeyRef.every((byte) => byte === 0)).toBe(true);
  });

  test('logout() xóa khóa khỏi bộ nhớ (memzero) - khóa cũ thành toàn số 0', async () => {
    const alice = newClient(createMemoryServer());
    await alice.register('alice13@example.com', 'mat-khau-cua-alice');
    const masterKeyRef = alice._session.masterKey;
    expect(masterKeyRef.some((byte) => byte !== 0)).toBe(true);

    await alice.logout();
    expect(masterKeyRef.every((byte) => byte === 0)).toBe(true);
  });

  test('nội dung vượt giới hạn bị chặn ngay ở client, không gửi lên server (D28)', async () => {
    const alice = newClient(createMemoryServer());
    await alice.register('alice15@example.com', 'mk-du-dai-hon');

    const quaDai = 'a'.repeat(LIMITS.MAX_NOTE_PLAINTEXT_BYTES + 1);
    await expect(alice.createNote({ title: 'To quá', content: quaDai })).rejects.toThrow(
      'vượt giới hạn',
    );
    expect(await alice.listNotes()).toHaveLength(0);
  });

  test('tiêu đề vượt giới hạn cũng bị chặn ngay ở client', async () => {
    const alice = newClient(createMemoryServer());
    await alice.register('alice16@example.com', 'mk-du-dai-hon');

    const quaDai = 'a'.repeat(LIMITS.MAX_NOTE_TITLE_BYTES + 1);
    await expect(alice.createNote({ title: quaDai, content: 'ok' })).rejects.toThrow(
      'Tiêu đề note',
    );
    expect(await alice.listNotes()).toHaveLength(0);
  });

  test('tiêu đề tính theo byte UTF-8, không theo số ký tự', async () => {
    const alice = newClient(createMemoryServer());
    await alice.register('alice17@example.com', 'mk-du-dai-hon');

    // Mỗi chữ "ế" chiếm 3 byte: 342 chữ = 1026 byte > 1024 dù chỉ có 342 ký tự.
    const title = 'ế'.repeat(Math.floor(LIMITS.MAX_NOTE_TITLE_BYTES / 3) + 1);
    expect(title.length).toBeLessThan(LIMITS.MAX_NOTE_TITLE_BYTES);
    await expect(alice.createNote({ title, content: 'ok' })).rejects.toThrow('Tiêu đề note');
  });
});

describe('memoryTransport là bản kiểm tra hợp đồng API, không chỉ là kho dữ liệu giả', () => {
  test('payload dùng tên trường cũ (saltB64, publicKeyB64...) bị từ chối - D34', async () => {
    const transport = createMemoryTransport();

    await expect(
      transport.register({
        email: 'cu@example.com',
        saltB64: 'AAAAAAAAAAAAAAAAAAAAAA',
        authKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        wrappedVaultKey: { nonce: 'a', ciphertext: 'b' },
        publicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        wrappedPrivateKey: { nonce: 'a', ciphertext: 'b' },
        signingPublicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        wrappedSigningPrivateKey: { nonce: 'a', ciphertext: 'b' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('thao tác cần đăng nhập mà chưa có phiên thì trả UNAUTHENTICATED (D16)', async () => {
    const transport = createMemoryTransport();
    await expect(transport.listNotes()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  test('email chưa đăng ký vẫn nhận được salt, cố định theo email (D15)', async () => {
    const transport = createMemoryTransport();

    const lan1 = await transport.getSalt('khong-ton-tai@example.com');
    const lan2 = await transport.getSalt('KHONG-TON-TAI@example.com');
    const khac = await transport.getSalt('nguoi-khac@example.com');

    expect(lan1.salt).toBe(lan2.salt);
    expect(lan1.salt).not.toBe(khac.salt);
    expect(lan1.kdfParams).toEqual({ ...KDF_DEFAULTS });
  });
});

describe('sửa, xóa, chia sẻ và thu hồi quyền', () => {
  let server;
  let alice;
  let bob;

  beforeEach(async () => {
    server = createMemoryServer();
    alice = newClient(server);
    bob = newClient(server);
    await alice.register('alice@example.com', 'mk-alice-dai');
    await bob.register('bob@example.com', 'mk-bob-dai');
  });

  /** Alice tạo một note rồi chia sẻ cho từng người trong danh sách. */
  async function sharedNote(recipients, input = { title: 'Kế hoạch', content: 'Nội dung gốc' }) {
    const { id } = await alice.createNote(input);
    for (const email of recipients) await alice.shareNote(id, email);
    return id;
  }

  describe('updateNote', () => {
    test('sửa thành công: version tăng, người được chia sẻ đọc được bản mới mà không cần gói mới', async () => {
      const id = await sharedNote(['bob@example.com']);
      const opened = await alice.readNote(id);

      const res = await alice.updateNote(id, {
        title: 'Kế hoạch v2',
        content: 'Nội dung mới',
        version: opened.version,
      });

      expect(res.version).toBe(2);
      expect(await alice.readNote(id)).toMatchObject({
        title: 'Kế hoạch v2',
        content: 'Nội dung mới',
        version: 2,
      });
      expect((await bob.readNote(id)).content).toBe('Nội dung mới');
      expect((await alice.listNotes())[0].title).toBe('Kế hoạch v2');
    });

    test('hai thiết bị cùng sửa từ một bản: bản lưu sau bị từ chối, không ghi đè bản trước', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'Gốc' });
      const phone = newClient(server);
      await phone.login('alice@example.com', 'mk-alice-dai');
      const onLaptop = await alice.readNote(id);
      const onPhone = await phone.readNote(id);

      await alice.updateNote(id, { title: 'T', content: 'Từ laptop', version: onLaptop.version });
      const late = phone.updateNote(id, {
        title: 'T',
        content: 'Từ điện thoại',
        version: onPhone.version,
      });

      await expect(late).rejects.toBeInstanceOf(ApiError);
      await expect(late).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
      expect((await alice.readNote(id)).content).toBe('Từ laptop');
    });

    test('thiếu version hoặc version không hợp lệ bị từ chối ngay', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'C' });
      for (const version of [undefined, 0, 1.5, '1']) {
        await expect(alice.updateNote(id, { title: 'T', content: 'X', version })).rejects.toThrow(
          TypeError,
        );
      }
      expect((await alice.readNote(id)).content).toBe('C');
    });

    test('người được chia sẻ không sửa được note, nội dung giữ nguyên', async () => {
      const id = await sharedNote(['bob@example.com']);
      await expect(
        bob.updateNote(id, { title: 'Hack', content: 'Bị sửa', version: 1 }),
      ).rejects.toThrow('không phải chủ');
      expect((await alice.readNote(id)).content).toBe('Nội dung gốc');
    });

    test('người không liên quan nhận NOT_FOUND', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'C' });
      await expect(
        bob.updateNote(id, { title: 'T', content: 'X', version: 1 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    test('tiêu đề mới quá lớn bị chặn ở client', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'C' });
      const tooBig = 'a'.repeat(LIMITS.MAX_NOTE_TITLE_BYTES + 1);
      await expect(
        alice.updateNote(id, { title: tooBig, content: 'C', version: 1 }),
      ).rejects.toThrow('Tiêu đề note');
      expect((await alice.readNote(id)).version).toBe(1);
    });
  });

  describe('deleteNote', () => {
    test('chủ note xóa được; note và gói chia sẻ của nó biến mất', async () => {
      const id = await sharedNote(['bob@example.com']);

      await alice.deleteNote(id);

      expect(await alice.listNotes()).toEqual([]);
      await expect(alice.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(bob.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await bob.listSharedWithMe()).toEqual([]);
    });

    test('người được chia sẻ và người ngoài không xóa được', async () => {
      const id = await sharedNote(['bob@example.com']);
      const eve = newClient(server);
      await eve.register('eve@example.com', 'mk-eve-dai');

      await expect(bob.deleteNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(eve.deleteNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await alice.readNote(id)).content).toBe('Nội dung gốc');
    });
  });

  describe('listNoteShares và unshareNote', () => {
    test('chủ note thấy danh sách người nhận; người nhận thì không', async () => {
      const carol = newClient(server);
      await carol.register('carol@example.com', 'mk-carol-dai');
      const id = await sharedNote(['bob@example.com', 'carol@example.com']);

      const list = await alice.listNoteShares(id);

      expect(list.map((s) => s.recipientEmail)).toEqual(['bob@example.com', 'carol@example.com']);
      await expect(bob.listNoteShares(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    test('gỡ chia sẻ: người nhận mất quyền đọc qua server', async () => {
      const id = await sharedNote(['bob@example.com']);
      const [share] = await alice.listNoteShares(id);

      await alice.unshareNote(share.id);

      await expect(bob.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await alice.listNoteShares(id)).toEqual([]);
    });

    test('người nhận không tự gỡ được gói chia sẻ (chỉ người gửi)', async () => {
      const id = await sharedNote(['bob@example.com']);
      const [share] = await alice.listNoteShares(id);

      await expect(bob.unshareNote(share.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await bob.readNote(id)).content).toBe('Nội dung gốc');
    });
  });

  describe('revokeAccess (xoay khóa, D24)', () => {
    let carol;

    beforeEach(async () => {
      carol = newClient(server);
      await carol.register('carol@example.com', 'mk-carol-dai');
    });

    test('thu hồi Bob, giữ Carol: Bob mất quyền, Carol và Alice vẫn đọc được', async () => {
      const id = await sharedNote(['bob@example.com', 'carol@example.com']);

      const res = await alice.revokeAccess(id, ['BOB@example.com']);

      expect(res).toMatchObject({ id, version: 2, keptRecipients: ['carol@example.com'] });
      await expect(bob.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await alice.readNote(id)).toMatchObject({
        title: 'Kế hoạch',
        content: 'Nội dung gốc',
      });
      expect((await carol.readNote(id)).content).toBe('Nội dung gốc');
      expect((await alice.listNoteShares(id)).map((s) => s.recipientEmail)).toEqual([
        'carol@example.com',
      ]);
    });

    test('là thu hồi MẬT MÃ: khóa cũ Bob có thể đã giữ lại không mở được nội dung mới', async () => {
      const id = await sharedNote(['bob@example.com', 'carol@example.com']);
      // Bob đã mở note trước đó, nên có thể đã giữ gói chia sẻ (và khóa note) cũ.
      const before = await bob.transport.getNote(id);
      const aliceKeys = await bob.transport.getUserKeys('alice@example.com');
      const oldKey = await sharing.unwrapNoteKeyFromSender(
        before.share.sharePackage,
        bob._session.x25519PrivateKey,
        fromBase64(aliceKeys.ed25519PublicKey),
        id,
      );
      // Khóa cũ đúng là khóa thật: mở được nội dung cũ.
      expect(
        await noteCrypto.decryptNote(before.encryptedContent, oldKey, {
          noteId: id,
          version: before.version,
          field: 'content',
        }),
      ).toBe('Nội dung gốc');

      await alice.revokeAccess(id, ['bob@example.com']);

      const after = await carol.transport.getNote(id);
      expect(after.encryptedContent).not.toEqual(before.encryptedContent);
      await expect(
        noteCrypto.decryptNote(after.encryptedContent, oldKey, {
          noteId: id,
          version: after.version,
          field: 'content',
        }),
      ).rejects.toThrow();
      await expect(
        noteCrypto.decryptNote(after.encryptedTitle, oldKey, {
          noteId: id,
          version: after.version,
          field: 'title',
        }),
      ).rejects.toThrow();
    });

    test('email không nằm trong danh sách chia sẻ: báo lỗi và không đổi gì', async () => {
      const id = await sharedNote(['bob@example.com']);

      await expect(alice.revokeAccess(id, ['carol@example.com'])).rejects.toThrow(
        'không được chia sẻ cho: carol@example.com',
      );
      expect((await alice.readNote(id)).version).toBe(1);
      expect((await bob.readNote(id)).content).toBe('Nội dung gốc');
    });

    test('danh sách rỗng: chỉ xoay khóa, mọi người giữ quyền', async () => {
      const id = await sharedNote(['bob@example.com']);
      const keyBefore = (await alice.transport.getNote(id)).wrappedNoteKey;

      const res = await alice.revokeAccess(id, []);

      expect(res).toMatchObject({ version: 2, keptRecipients: ['bob@example.com'] });
      expect((await alice.transport.getNote(id)).wrappedNoteKey).not.toEqual(keyBefore);
      expect((await bob.readNote(id)).content).toBe('Nội dung gốc');
    });

    test('người được chia sẻ không thu hồi được quyền của người khác', async () => {
      const id = await sharedNote(['bob@example.com', 'carol@example.com']);
      await expect(bob.revokeAccess(id, ['carol@example.com'])).rejects.toThrow('không phải chủ');
      expect((await carol.readNote(id)).content).toBe('Nội dung gốc');
    });

    test('sửa note sau khi thu hồi: người còn quyền đọc được, người bị thu hồi thì không', async () => {
      const id = await sharedNote(['bob@example.com', 'carol@example.com']);
      await alice.revokeAccess(id, ['bob@example.com']);
      const current = await alice.readNote(id);

      await alice.updateNote(id, {
        title: 'Sau thu hồi',
        content: 'Bản mới',
        version: current.version,
      });

      expect((await carol.readNote(id)).content).toBe('Bản mới');
      await expect(bob.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('chính sách mật khẩu khi đăng ký và đổi mật khẩu', () => {
  /** Transport đếm số lần gọi, để chứng minh mật khẩu yếu bị chặn TRƯỚC khi có request nào. */
  function countingTransport(server = createMemoryServer()) {
    const inner = server.connect();
    const calls = [];
    const transport = {};
    for (const [name, fn] of Object.entries(inner)) {
      transport[name] = (...args) => {
        calls.push(name);
        return fn(...args);
      };
    }
    return { transport, calls };
  }

  test.each([
    ['quá ngắn', 'abc1234', 'TOO_SHORT'],
    ['phổ biến', 'password1', 'TOO_COMMON'],
    ['phổ biến, khác hoa thường', 'IloveYou', 'TOO_COMMON'],
  ])('đăng ký với mật khẩu %s bị từ chối và không gửi gì lên server', async (_n, pw, problem) => {
    const { transport, calls } = countingTransport();
    const client = new SecureNoteClient(transport);

    const attempt = client.register('alice@example.com', pw);

    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ code: 'WEAK_PASSWORD', problems: [problem] });
    expect(calls).toEqual([]);
    expect(client.isLoggedIn()).toBe(false);
  });

  test('đổi sang mật khẩu mới yếu bị từ chối, mật khẩu cũ vẫn dùng được', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    await alice.register('alice@example.com', 'mat-khau-cu-dai');
    const { transport, calls } = countingTransport(server);
    alice.transport = transport;

    await expect(alice.changePassword('mat-khau-cu-dai', 'password1')).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });

    expect(calls).toEqual([]);
    await newClient(server).login('alice@example.com', 'mat-khau-cu-dai');
  });

  test('đăng nhập KHÔNG áp chính sách: mật khẩu ngắn sai nhận lỗi đăng nhập, không phải WEAK_PASSWORD', async () => {
    const server = createMemoryServer();
    await newClient(server).register('alice@example.com', 'mat-khau-du-dai');
    // Nếu login cũng chặn mật khẩu ngắn thì tài khoản đặt trước khi có chính sách sẽ bị khóa ngoài.
    await expect(newClient(server).login('alice@example.com', 'abc')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  test('đổi mật khẩu KHÔNG kiểm tra độ mạnh của mật khẩu CŨ', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    await alice.register('alice@example.com', 'mat-khau-du-dai');
    // Mật khẩu cũ sai và ngắn: phải bị server từ chối vì sai, không phải bị chặn vì yếu.
    await expect(alice.changePassword('abc', 'mat-khau-moi-dai')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  test('mật khẩu có khoảng trắng hai đầu được giữ nguyên: đăng nhập phải gõ đúng y hệt', async () => {
    const server = createMemoryServer();
    await newClient(server).register('alice@example.com', '  mat khau co dau cach  ');

    await newClient(server).login('alice@example.com', '  mat khau co dau cach  ');
    await expect(
      newClient(server).login('alice@example.com', 'mat khau co dau cach'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
});

describe('quản lý phiên đăng nhập', () => {
  const PW = 'mk-alice-du-dai';
  let server;
  let laptop;
  let phone;

  beforeEach(async () => {
    server = createMemoryServer();
    laptop = new SecureNoteClient(server.connect());
    await laptop.register('alice@example.com', PW);
    phone = new SecureNoteClient(server.connect());
    await phone.login('alice@example.com', PW);
  });

  test('listSessions: thấy cả hai thiết bị, đánh dấu đúng thiết bị hiện tại', async () => {
    const sessions = await laptop.listSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const seenFromPhone = await phone.listSessions();
    const laptopId = sessions.find((s) => s.current).id;
    expect(seenFromPhone.find((s) => s.current).id).not.toBe(laptopId);
  });

  test('đăng xuất đúng thiết bị kia: thiết bị kia mất phiên, thiết bị này vẫn dùng được', async () => {
    const other = (await laptop.listSessions()).find((s) => !s.current);

    expect(await laptop.revokeSessions(PW, other.id)).toEqual({ revoked: 1 });

    await expect(phone.listNotes()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(laptop.listNotes()).resolves.toEqual([]);
  });

  test('không truyền sessionId: đăng xuất mọi thiết bị khác', async () => {
    const tablet = new SecureNoteClient(server.connect());
    await tablet.login('alice@example.com', PW);

    expect(await laptop.revokeSessions(PW)).toEqual({ revoked: 2 });

    expect(await laptop.listSessions()).toHaveLength(1);
    await expect(tablet.listSessions()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  test('sai mật khẩu: INVALID_CREDENTIALS, không thiết bị nào bị đăng xuất', async () => {
    await expect(laptop.revokeSessions('mat-khau-sai-roi')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(phone.listNotes()).resolves.toEqual([]);
  });

  test('không đăng xuất chính mình qua đây', async () => {
    const mine = (await laptop.listSessions()).find((s) => s.current);
    await expect(laptop.revokeSessions(PW, mine.id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  test('loginHistory: có cả lần sai mật khẩu, mới nhất trước', async () => {
    const guesser = new SecureNoteClient(server.connect());
    await expect(guesser.login('alice@example.com', 'doan-bua-thoi')).rejects.toThrow();

    const history = await laptop.loginHistory();

    expect(history.map((e) => e.success)).toEqual([false, true, true]);
    expect(new Set(history.map((e) => e.kind))).toEqual(new Set(['login']));
  });

  test('loginHistory ghi cả lần nhập lại mật khẩu, đúng lẫn sai, với loại tương ứng', async () => {
    await expect(laptop.revokeSessions('mat-khau-sai-roi')).rejects.toThrow();
    await laptop.changePassword(PW, 'mat-khau-moi-du-dai');

    const [latest, previous] = await laptop.loginHistory();

    expect(latest).toMatchObject({ kind: 'change_password', success: true });
    expect(previous).toMatchObject({ kind: 'revoke_sessions', success: false });
  });

  test('đổi mật khẩu cũng đăng xuất các thiết bị khác (D25)', async () => {
    await laptop.changePassword(PW, 'mat-khau-moi-du-dai');
    await expect(phone.listNotes()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await laptop.listSessions()).toHaveLength(1);
  });

  test('chưa đăng nhập thì báo lỗi ngay, không gọi mạng', async () => {
    const guest = new SecureNoteClient(server.connect());
    await expect(guest.listSessions()).rejects.toThrow('Chưa đăng nhập');
    await expect(guest.revokeSessions(PW)).rejects.toThrow('Chưa đăng nhập');
    await expect(guest.loginHistory()).rejects.toThrow('Chưa đăng nhập');
  });
});

describe('xóa tài khoản', () => {
  const PW = 'mk-alice-du-dai';
  let server;
  let alice;
  let bob;

  beforeEach(async () => {
    server = createMemoryServer();
    alice = new SecureNoteClient(server.connect());
    await alice.register('alice@example.com', PW);
    bob = new SecureNoteClient(server.connect());
    await bob.register('bob@example.com', 'mk-bob-du-dai');
  });

  test('thành công: đăng xuất, khóa bị xóa, thiết bị khác mất phiên, không đăng nhập lại được', async () => {
    const phone = new SecureNoteClient(server.connect());
    await phone.login('alice@example.com', PW);

    await alice.deleteAccount(PW);

    expect(alice.isLoggedIn()).toBe(false);
    await expect(phone.listNotes()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const again = new SecureNoteClient(server.connect());
    await expect(again.login('alice@example.com', PW)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  test('note Alice chia sẻ cho Bob biến mất khỏi hộp thư của Bob', async () => {
    const { id } = await alice.createNote({ title: 'Cho Bob', content: 'x' });
    await alice.shareNote(id, 'bob@example.com');

    await alice.deleteAccount(PW);

    expect(await bob.listSharedWithMe()).toEqual([]);
    await expect(bob.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('sai mật khẩu: INVALID_CREDENTIALS, vẫn đăng nhập, dữ liệu còn nguyên', async () => {
    await alice.createNote({ title: 'T', content: 'C' });

    await expect(alice.deleteAccount('mat-khau-sai-roi')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    expect(alice.isLoggedIn()).toBe(true);
    expect(await alice.listNotes()).toHaveLength(1);
  });

  test('xóa "version đã thấy" của tài khoản khỏi trình duyệt, không đụng người dùng khác', async () => {
    const data = new Map();
    const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    // Một kho cho cả trang, như web/src/client.js; hai người lần lượt dùng chung trình duyệt.
    const versionStore = createLocalStorageVersionStore(storage);
    const aliceHere = new SecureNoteClient(server.connect(), { versionStore });
    await aliceHere.login('alice@example.com', PW);
    await aliceHere.createNote({ title: 'A', content: 'a' });
    const bobHere = new SecureNoteClient(server.connect(), { versionStore });
    await bobHere.login('bob@example.com', 'mk-bob-du-dai');
    await bobHere.createNote({ title: 'B', content: 'b' });

    await aliceHere.deleteAccount(PW);

    const saved = JSON.stringify(Object.keys(JSON.parse([...data.values()].at(-1))));
    expect(saved).not.toContain('alice@example.com');
    expect(saved).toContain('bob@example.com');
  });

  test('chưa đăng nhập thì báo lỗi ngay', async () => {
    const guest = new SecureNoteClient(server.connect());
    await expect(guest.deleteAccount(PW)).rejects.toThrow('Chưa đăng nhập');
  });
});

describe('vệ sinh bộ nhớ khi đăng ký thất bại', () => {
  test('email đã có: mọi khóa riêng vừa sinh bị xóa về 0, không nằm lại trong bộ nhớ', async () => {
    const server = createMemoryServer();
    await new SecureNoteClient(server.connect()).register('alice@example.com', 'mk-alice-du-dai');
    const sodium = await getSodium();
    const boxSpy = vi.spyOn(sodium, 'crypto_box_keypair');
    const signSpy = vi.spyOn(sodium, 'crypto_sign_keypair');

    const again = new SecureNoteClient(server.connect());
    await expect(again.register('alice@example.com', 'mk-khac-du-dai')).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });

    const keys = [boxSpy, signSpy].map((spy) => spy.mock.results[0].value.privateKey);
    boxSpy.mockRestore();
    signSpy.mockRestore();
    for (const key of keys) expect(key.every((b) => b === 0)).toBe(true);
    expect(again.isLoggedIn()).toBe(false);
  });
});

describe('vệ sinh bộ nhớ khi đăng nhập', () => {
  /** Ghi lại mọi khóa 32 byte do crypto_kdf sinh ra (authKey, masterKey) trong lúc chạy `fn`. */
  async function captureDerivedKeys(fn) {
    const sodium = await getSodium();
    const spy = vi.spyOn(sodium, 'crypto_kdf_derive_from_key');
    try {
      await fn();
    } catch {
      // Một số trường hợp cố tình thất bại.
    }
    const keys = spy.mock.results.map((r) => r.value);
    spy.mockRestore();
    return keys;
  }

  test('sai mật khẩu: authKey và masterKey vừa dẫn xuất đều bị xóa về 0', async () => {
    const server = createMemoryServer();
    await new SecureNoteClient(server.connect()).register('alice@example.com', 'mk-alice-du-dai');

    const keys = await captureDerivedKeys(() =>
      new SecureNoteClient(server.connect()).login('alice@example.com', 'mat-khau-sai-roi'),
    );

    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key.every((b) => b === 0)).toBe(true);
  });

  test('đăng nhập đúng: authKey bị xóa ngay, masterKey giữ lại cho phiên làm việc', async () => {
    const server = createMemoryServer();
    await new SecureNoteClient(server.connect()).register('alice@example.com', 'mk-alice-du-dai');
    const client = new SecureNoteClient(server.connect());

    const [authKey, masterKey] = await captureDerivedKeys(() =>
      client.login('alice@example.com', 'mk-alice-du-dai'),
    );

    expect(authKey.every((b) => b === 0)).toBe(true);
    expect(masterKey.some((b) => b !== 0)).toBe(true);
    await client.logout();
    expect(masterKey.every((b) => b === 0)).toBe(true);
  });
});
