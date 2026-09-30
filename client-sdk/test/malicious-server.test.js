import { beforeEach, describe, expect, test } from 'vitest';
import { SecureNoteClient } from '../src/client.js';
import { createMemoryServer } from '../src/memoryTransport.js';
import { ApiError } from '../src/apiError.js';
import { createLocalStorageVersionStore, createMemoryVersionStore } from '../src/versionStore.js';

/**
 * Server độc hại: bọc một kết nối thật tới server giả, cho phép test sửa response trước khi
 * SecureNoteClient nhìn thấy. Mỗi test dưới đây là một kiểu tấn công mà D19/D20/D23 phải chặn.
 */
function maliciousConnection(server) {
  const inner = server.connect();
  const hooks = {};
  const transport = {};
  for (const [name, fn] of Object.entries(inner)) {
    transport[name] = async (...args) => {
      const result = await fn(...args);
      return hooks[name] ? hooks[name](structuredClone(result), ...args) : result;
    };
  }
  return { transport, hooks, inner };
}

describe('client chống server độc hại (D19, D20, D23)', () => {
  let server;
  let alice;
  let attack;

  beforeEach(async () => {
    server = createMemoryServer();
    attack = maliciousConnection(server);
    alice = new SecureNoteClient(attack.transport);
    await alice.register('alice@example.com', 'mk-alice-du-dai');
  });

  describe('D19: ciphertext gắn với đúng note, đúng version, đúng trường', () => {
    test('tráo ciphertext tiêu đề với nội dung: bị phát hiện', async () => {
      const { id } = await alice.createNote({ title: 'Tiêu đề', content: 'Nội dung' });
      attack.hooks.getNote = (record) => ({
        ...record,
        encryptedTitle: record.encryptedContent,
        encryptedContent: record.encryptedTitle,
      });

      await expect(alice.readNote(id)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
    });

    test('trả nội dung của note B khi được hỏi note A: bị phát hiện', async () => {
      const a = await alice.createNote({ title: 'A', content: 'Nội dung A' });
      const b = await alice.createNote({ title: 'B', content: 'Nội dung B' });
      const recordB = await attack.inner.getNote(b.id);
      // Giữ id A cho khớp với câu hỏi, nhưng ruột là của B (cả khóa lẫn ciphertext).
      attack.hooks.getNote = (record, noteId) =>
        noteId === a.id ? { ...recordB, id: a.id } : record;

      await expect(alice.readNote(a.id)).rejects.toThrow();
    });

    test('trả về note có id khác với id được hỏi: bị từ chối', async () => {
      const a = await alice.createNote({ title: 'A', content: 'A' });
      const b = await alice.createNote({ title: 'B', content: 'B' });
      attack.hooks.getNote = (record, noteId) =>
        noteId === a.id ? attack.inner.getNote(b.id) : record;

      await expect(alice.readNote(a.id)).rejects.toThrow('note khác');
    });

    test('ciphertext cũ nhưng khai là version mới: bị phát hiện', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'Bản cũ' });
      const v1 = await attack.inner.getNote(id);
      await alice.updateNote(id, { title: 'T', content: 'Bản mới', version: 1 });
      attack.hooks.getNote = (record) => ({ ...v1, version: record.version }); // khai v2

      await expect(alice.readNote(id)).rejects.toThrow();
    });

    test('tiêu đề trong danh sách bị tráo sang note khác: bị phát hiện', async () => {
      await alice.createNote({ title: 'A', content: 'A' });
      await alice.createNote({ title: 'B', content: 'B' });
      attack.hooks.listNotes = (items) => [
        {
          ...items[0],
          encryptedTitle: items[1].encryptedTitle,
          wrappedNoteKey: items[1].wrappedNoteKey,
        },
        items[1],
      ];

      await expect(alice.listNotes()).rejects.toThrow();
    });
  });

  describe('D20: chống trả về bản cũ (rollback)', () => {
    test('đã thấy v2, server trả trọn vẹn bản v1 (khớp nhau): ROLLBACK_DETECTED', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'Bản cũ' });
      const v1 = await attack.inner.getNote(id);
      await alice.updateNote(id, { title: 'T', content: 'Bản mới', version: 1 });
      attack.hooks.getNote = () => v1;

      const read = alice.readNote(id);
      await expect(read).rejects.toBeInstanceOf(ApiError);
      await expect(read).rejects.toMatchObject({ code: 'ROLLBACK_DETECTED' });
    });

    test('rollback trong danh sách note cũng bị phát hiện', async () => {
      const { id } = await alice.createNote({ title: 'Cũ', content: 'C' });
      const oldList = await attack.inner.listNotes();
      await alice.updateNote(id, { title: 'Mới', content: 'C', version: 1 });
      attack.hooks.listNotes = () => oldList;

      await expect(alice.listNotes()).rejects.toMatchObject({ code: 'ROLLBACK_DETECTED' });
    });

    test('rollback khi sửa note: bị chặn TRƯỚC khi ghi, không đè lên bản mới', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'Bản 1' });
      const v1 = await attack.inner.getNote(id);
      await alice.updateNote(id, { title: 'T', content: 'Bản 2', version: 1 });
      attack.hooks.getNote = () => v1;

      await expect(
        alice.updateNote(id, { title: 'T', content: 'Sửa trên bản cũ', version: 1 }),
      ).rejects.toMatchObject({ code: 'ROLLBACK_DETECTED' });
      attack.hooks.getNote = undefined;
      expect((await alice.readNote(id)).content).toBe('Bản 2');
    });

    test('bản mới hơn thì luôn được nhận, và trở thành mốc mới', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'v1' });
      const phone = new SecureNoteClient(server.connect());
      await phone.login('alice@example.com', 'mk-alice-du-dai');
      await phone.updateNote(id, { title: 'T', content: 'v2 từ điện thoại', version: 1 });

      expect((await alice.readNote(id)).content).toBe('v2 từ điện thoại');
    });

    test('GIỚI HẠN đã biết: thiết bị mới đọc lần đầu thì chưa có gì để so', async () => {
      const { id } = await alice.createNote({ title: 'T', content: 'Bản cũ' });
      const v1 = await attack.inner.getNote(id);
      await alice.updateNote(id, { title: 'T', content: 'Bản mới', version: 1 });

      const fresh = maliciousConnection(server);
      const newDevice = new SecureNoteClient(fresh.transport);
      await newDevice.login('alice@example.com', 'mk-alice-du-dai');
      fresh.hooks.getNote = () => v1;

      // Đây là giới hạn ghi trong THREAT_MODEL mục 4, không phải lỗi: bản cũ được chấp nhận.
      expect((await newDevice.readNote(id)).content).toBe('Bản cũ');
    });
  });

  describe('khóa công khai của chính mình', () => {
    test('đăng nhập: máy chủ trả khóa công khai không khớp khóa riêng thì bị từ chối', async () => {
      const victim = maliciousConnection(server);
      victim.hooks.login = (account) => ({
        ...account,
        x25519PublicKey: 'A'.repeat(43), // 32 byte hợp lệ về hình dạng, nhưng không phải khóa thật
      });
      const client = new SecureNoteClient(victim.transport);

      await expect(client.login('alice@example.com', 'mk-alice-du-dai')).rejects.toMatchObject({
        code: 'INTEGRITY_ERROR',
      });
      expect(client.isLoggedIn()).toBe(false);
    });

    test('myFingerprint tính tại chỗ, khớp với mã người khác tra qua máy chủ trung thực', async () => {
      const bob = new SecureNoteClient(server.connect());
      await bob.register('bob@example.com', 'mk-bob-du-dai');

      const own = alice.myFingerprint();
      const seenByBob = await bob.getFingerprint('alice@example.com');

      expect(own).toEqual(seenByBob);
    });

    test('máy chủ tráo khóa của Alice khi đưa cho Bob: mã hai bên KHÔNG khớp, đối chiếu tay phát hiện được', async () => {
      const bobAttack = maliciousConnection(server);
      const bob = new SecureNoteClient(bobAttack.transport);
      await bob.register('bob@example.com', 'mk-bob-du-dai');
      const mallory = new SecureNoteClient(server.connect());
      await mallory.register('mallory@example.com', 'mk-mallory-dai');
      const malloryKeys = await bobAttack.inner.getUserKeys('mallory@example.com');
      bobAttack.hooks.getUserKeys = (keys, email) =>
        email === 'alice@example.com' ? malloryKeys : keys;

      const seenByBob = await bob.getFingerprint('alice@example.com');

      expect(seenByBob.x25519Fingerprint).not.toBe(alice.myFingerprint().x25519Fingerprint);
    });

    test('máy chủ đưa khóa thật lúc đối chiếu rồi tráo khóa lúc chia sẻ: bị từ chối (D75)', async () => {
      const bob = new SecureNoteClient(server.connect());
      await bob.register('bob@example.com', 'mk-bob-du-dai');
      const mallory = new SecureNoteClient(server.connect());
      await mallory.register('mallory@example.com', 'mk-mallory-dai');
      const malloryKeys = await attack.inner.getUserKeys('mallory@example.com');
      const { id } = await alice.createNote({ title: 'Bí mật', content: 'Nội dung' });

      const verified = await alice.getFingerprint('bob@example.com'); // lúc này khóa thật
      attack.hooks.getUserKeys = (keys, email) =>
        email === 'bob@example.com' ? malloryKeys : keys;

      await expect(
        alice.shareNote(id, 'bob@example.com', { verifiedFingerprint: verified }),
      ).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
      expect(await attack.inner.listNoteShares(id)).toEqual([]);
    });

    test('fingerprint đã đối chiếu của người khác không dùng để chia sẻ cho người này được', async () => {
      const bob = new SecureNoteClient(server.connect());
      await bob.register('bob@example.com', 'mk-bob-du-dai');
      const carol = new SecureNoteClient(server.connect());
      await carol.register('carol@example.com', 'mk-carol-du-dai');
      const { id } = await alice.createNote({ title: 'T', content: 'C' });
      const verifiedBob = await alice.getFingerprint('bob@example.com');

      await expect(
        alice.shareNote(id, 'carol@example.com', { verifiedFingerprint: verifiedBob }),
      ).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
    });

    test('khóa không đổi giữa lúc đối chiếu và lúc chia sẻ: chia sẻ thành công', async () => {
      const bob = new SecureNoteClient(server.connect());
      await bob.register('bob@example.com', 'mk-bob-du-dai');
      const { id } = await alice.createNote({ title: 'T', content: 'Cho Bob' });
      const verified = await alice.getFingerprint('BOB@example.com');

      await alice.shareNote(id, 'bob@example.com', { verifiedFingerprint: verified });

      expect((await bob.readNote(id)).content).toBe('Cho Bob');
    });

    test('myFingerprint khi chưa đăng nhập thì báo lỗi', () => {
      const client = new SecureNoteClient(server.connect());
      expect(() => client.myFingerprint()).toThrow('Chưa đăng nhập');
    });
  });

  describe('D23: gói chia sẻ gắn với đúng note', () => {
    test('gói chia sẻ của note A đem gắn sang note B: chữ ký không hợp lệ', async () => {
      const bobAttack = maliciousConnection(server);
      const bob = new SecureNoteClient(bobAttack.transport);
      await bob.register('bob@example.com', 'mk-bob-du-dai');
      const a = await alice.createNote({ title: 'A', content: 'Nội dung A' });
      const b = await alice.createNote({ title: 'B', content: 'Nội dung B' });
      await alice.shareNote(a.id, 'bob@example.com');
      await alice.shareNote(b.id, 'bob@example.com');
      const packageOfA = (await bobAttack.inner.getNote(a.id)).share.sharePackage;
      bobAttack.hooks.getNote = (record, noteId) =>
        noteId === b.id
          ? { ...record, share: { ...record.share, sharePackage: packageOfA } }
          : record;

      await expect(bob.readNote(b.id)).rejects.toThrow('Chu ky khong hop le');
      await expect(bob.readNote(b.id)).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
      expect((await bob.readNote(a.id)).content).toBe('Nội dung A');
    });
  });
});

describe('nơi lưu version đã thấy', () => {
  function fakeStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
    };
  }

  test('bản bộ nhớ: tách riêng theo người dùng', () => {
    const store = createMemoryVersionStore();
    store.set('alice@example.com', 'n1', 5);
    expect(store.get('alice@example.com', 'n1')).toBe(5);
    expect(store.get('bob@example.com', 'n1')).toBeUndefined();
  });

  test('bản localStorage: còn nhớ sau khi "tải lại trang" (tạo lại từ cùng storage)', () => {
    const storage = fakeStorage();
    createLocalStorageVersionStore(storage).set('alice@example.com', 'n1', 7);
    expect(createLocalStorageVersionStore(storage).get('alice@example.com', 'n1')).toBe(7);
  });

  test('bản localStorage: dữ liệu hỏng hoặc bị sửa không làm sập, chỉ nhận số nguyên dương', () => {
    const broken = fakeStorage({ 'secure-notes:seen-versions': '{không phải json' });
    expect(createLocalStorageVersionStore(broken).get('a', 'n')).toBeUndefined();

    const tampered = fakeStorage({
      'secure-notes:seen-versions': JSON.stringify({
        'a|n1': 'x',
        'a|n2': -3,
        'a|n3': 1.5,
        'a|n4': 4,
      }),
    });
    const store = createLocalStorageVersionStore(tampered);
    expect(['n1', 'n2', 'n3'].map((n) => store.get('a', n))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(store.get('a', 'n4')).toBe(4);
  });

  test('bản localStorage: khóa "__proto__" không đụng tới prototype', () => {
    const storage = fakeStorage({ 'secure-notes:seen-versions': '{"__proto__": 9}' });
    const store = createLocalStorageVersionStore(storage);
    expect(store.get('__proto__', '')).toBeUndefined();
    expect({}.constructor).toBe(Object);
  });

  test('bản localStorage: không ghi được (chế độ riêng tư) thì vẫn nhớ trong bộ nhớ', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createLocalStorageVersionStore(storage);
    store.set('a', 'n1', 3);
    expect(store.get('a', 'n1')).toBe(3);
  });

  test('client dùng localStorage: rollback vẫn bị phát hiện sau khi "tải lại trang"', async () => {
    const server = createMemoryServer();
    const storage = fakeStorage();
    const attack = maliciousConnection(server);
    const tab1 = new SecureNoteClient(attack.transport, {
      versionStore: createLocalStorageVersionStore(storage),
    });
    await tab1.register('alice@example.com', 'mk-alice-du-dai');
    const { id } = await tab1.createNote({ title: 'T', content: 'Bản cũ' });
    const v1 = await attack.inner.getNote(id);
    await tab1.updateNote(id, { title: 'T', content: 'Bản mới', version: 1 });

    // Tải lại trang: client mới, đăng nhập lại, nhưng cùng localStorage.
    const reload = maliciousConnection(server);
    const tab2 = new SecureNoteClient(reload.transport, {
      versionStore: createLocalStorageVersionStore(storage),
    });
    await tab2.login('alice@example.com', 'mk-alice-du-dai');
    reload.hooks.getNote = () => v1;

    await expect(tab2.readNote(id)).rejects.toMatchObject({ code: 'ROLLBACK_DETECTED' });
    // Chỉ lưu id note và version: không có khóa, không có nội dung.
    const raw = storage.data.get('secure-notes:seen-versions');
    expect(raw).not.toMatch(/Bản|ciphertext|nonce|Key/);
  });
});
