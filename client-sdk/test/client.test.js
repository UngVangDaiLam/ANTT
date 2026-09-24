import { describe, test, expect } from 'vitest';
import { KDF_DEFAULTS, LIMITS } from '@secure-notes/shared';
import { SecureNoteClient } from '../src/client.js';
import { createMemoryServer, createMemoryTransport } from '../src/memoryTransport.js';
import { ApiError } from '../src/apiError.js';

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
    await alice.register('alice-list@example.com', 'mk');
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
    await newClient(server).register('trung@example.com', 'mk-1');

    await expect(newClient(server).register('TRUNG@example.com', 'mk-2')).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });

  test('chia sẻ một note cho Bob, Bob đọc được đúng nội dung', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    const bob = newClient(server);
    await alice.register('alice4@example.com', 'mk-alice');
    await bob.register('bob4@example.com', 'mk-bob');

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
    await bob.register('bob5@example.com', 'mk-bob');

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
    await bob.register('bob6@example.com', 'mk-bob');
    await eve.register('eve6@example.com', 'mk-eve');

    const { id } = await alice.createNote({ title: 'Riêng Bob', content: 'Chỉ dành cho Bob' });
    await alice.shareNote(id, 'bob6@example.com');

    await expect(eve.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('không thể chia sẻ note của người khác', async () => {
    const server = createMemoryServer();
    const alice = newClient(server);
    const eve = newClient(server);
    await alice.register('alice14@example.com', 'mk-alice');
    await eve.register('eve14@example.com', 'mk-eve');

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
    await bob.register('bob7@example.com', 'mk-bob');

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
    await bob.register('bob11@example.com', 'mk-bob');

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
    await alice.register('alice18@example.com', 'mk');
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
    await alice.register('alice19@example.com', 'mk');
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
    await alice.register('alice15@example.com', 'mk');

    const quaDai = 'a'.repeat(LIMITS.MAX_NOTE_PLAINTEXT_BYTES + 1);
    await expect(alice.createNote({ title: 'To quá', content: quaDai })).rejects.toThrow(
      'vượt giới hạn',
    );
    expect(await alice.listNotes()).toHaveLength(0);
  });

  test('tiêu đề vượt giới hạn cũng bị chặn ngay ở client', async () => {
    const alice = newClient(createMemoryServer());
    await alice.register('alice16@example.com', 'mk');

    const quaDai = 'a'.repeat(LIMITS.MAX_NOTE_TITLE_BYTES + 1);
    await expect(alice.createNote({ title: quaDai, content: 'ok' })).rejects.toThrow(
      'Tiêu đề note',
    );
    expect(await alice.listNotes()).toHaveLength(0);
  });

  test('tiêu đề tính theo byte UTF-8, không theo số ký tự', async () => {
    const alice = newClient(createMemoryServer());
    await alice.register('alice17@example.com', 'mk');

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
