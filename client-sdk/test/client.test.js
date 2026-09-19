import { describe, test, expect } from 'vitest';
import { SecureNoteClient } from '../src/client.js';
import { createMemoryTransport } from '../src/memoryTransport.js';

describe('SecureNoteClient (client SDK cap cao - thu nhu giao dien web se dung)', () => {
  test('dang ky, tao note, tu doc lai note cua chinh minh', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);

    await alice.register('alice@example.com', 'mat-khau-cua-alice');
    const { noteId } = await alice.createNote('Ghi chu bi mat cua Alice');

    const text = await alice.readNote(noteId);
    expect(text).toBe('Ghi chu bi mat cua Alice');
  });

  test('dang xuat roi dang nhap lai van doc duoc note cu', async () => {
    const transport = createMemoryTransport();
    const alice1 = new SecureNoteClient(transport);
    await alice1.register('alice2@example.com', 'mat-khau-cua-alice');
    const { noteId } = await alice1.createNote('Note can nho');
    alice1.logout();
    expect(alice1.isLoggedIn()).toBe(false);

    const alice2 = new SecureNoteClient(transport);
    await alice2.login('alice2@example.com', 'mat-khau-cua-alice');
    const text = await alice2.readNote(noteId);
    expect(text).toBe('Note can nho');
  });

  test('sai mat khau -> dang nhap phai that bai', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    await alice.register('alice3@example.com', 'mat-khau-dung');
    alice.logout();

    const attacker = new SecureNoteClient(transport);
    await expect(attacker.login('alice3@example.com', 'mat-khau-sai')).rejects.toThrow();
  });

  test('chia se dung 1 note cho Bob, Bob doc duoc dung noi dung', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    const bob = new SecureNoteClient(transport);

    await alice.register('alice4@example.com', 'mk-alice');
    await bob.register('bob4@example.com', 'mk-bob');

    const { noteId } = await alice.createNote('Danh sach mua sam');
    const { shareId } = await alice.shareNote(noteId, 'bob4@example.com');

    const sharedList = await bob.listSharedWithMe();
    expect(sharedList.some((s) => s.shareId === shareId)).toBe(true);

    const text = await bob.readSharedNote(shareId);
    expect(text).toBe('Danh sach mua sam');
  });

  test('Bob KHONG doc duoc note khac cua Alice ma khong duoc chia se (khong dung readNote, cung khong co shareId)', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    const bob = new SecureNoteClient(transport);

    await alice.register('alice5@example.com', 'mk-alice');
    await bob.register('bob5@example.com', 'mk-bob');

    const noteBiMat = await alice.createNote('TUYET MAT - khong chia se');
    await alice.createNote('Note cong khai hon');

    await expect(bob.readNote(noteBiMat.noteId)).rejects.toThrow('Ban khong phai chu note nay');

    const sharedList = await bob.listSharedWithMe();
    expect(sharedList.length).toBe(0);
  });

  test('nguoi thu 3 (khong phai nguoi nhan) khong the doc duoc goi chia se', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    const bob = new SecureNoteClient(transport);
    const eve = new SecureNoteClient(transport);

    await alice.register('alice6@example.com', 'mk-alice');
    await bob.register('bob6@example.com', 'mk-bob');
    await eve.register('eve6@example.com', 'mk-eve');

    const { noteId } = await alice.createNote('Chi danh cho Bob');
    const { shareId } = await alice.shareNote(noteId, 'bob6@example.com');

    await expect(eve.readSharedNote(shareId)).rejects.toBeTruthy();
  });

  test('getFingerprint tra ve fingerprint deterministic cho 1 email', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    const bob = new SecureNoteClient(transport);
    await alice.register('alice7@example.com', 'mk-alice');
    await bob.register('bob7@example.com', 'mk-bob');

    const fp1 = await alice.getFingerprint('bob7@example.com');
    const fp2 = await bob.getFingerprint('bob7@example.com');

    expect(fp1.encryptionKeyFingerprint).toBe(fp2.encryptionKeyFingerprint);
    expect(fp1.signingKeyFingerprint).toBe(fp2.signingKeyFingerprint);
  });

  test('goi ham can dang nhap ma chua dang nhap -> throw ro rang', async () => {
    const transport = createMemoryTransport();
    const client = new SecureNoteClient(transport);
    await expect(client.createNote('abc')).rejects.toThrow('Chua dang nhap');
  });

  test('doi mat khau thanh cong - dang nhap lai bang mat khau moi van doc duoc note cu', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    await alice.register('alice8@example.com', 'mat-khau-cu');
    const { noteId } = await alice.createNote('Ghi chu truoc khi doi mat khau');

    await alice.changePassword('mat-khau-cu', 'mat-khau-moi');

    alice.logout();
    const alice2 = new SecureNoteClient(transport);
    await alice2.login('alice8@example.com', 'mat-khau-moi');
    const text = await alice2.readNote(noteId);
    expect(text).toBe('Ghi chu truoc khi doi mat khau');
  });

  test('doi mat khau xong - mat khau cu khong con dung nua', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    await alice.register('alice9@example.com', 'mat-khau-cu');
    await alice.changePassword('mat-khau-cu', 'mat-khau-moi');
    alice.logout();

    const attacker = new SecureNoteClient(transport);
    await expect(attacker.login('alice9@example.com', 'mat-khau-cu')).rejects.toThrow();
  });

  test('doi mat khau voi sai mat khau cu -> tu choi, khong doi gi ca', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    await alice.register('alice10@example.com', 'mat-khau-dung');

    await expect(alice.changePassword('mat-khau-sai', 'mat-khau-moi')).rejects.toThrow();

    alice.logout();
    const alice2 = new SecureNoteClient(transport);
    await alice2.login('alice10@example.com', 'mat-khau-dung');
    expect(alice2.isLoggedIn()).toBe(true);
  });

  test('chia se van hoat dong binh thuong sau khi doi mat khau (private key duoc wrap lai dung)', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    const bob = new SecureNoteClient(transport);
    await alice.register('alice11@example.com', 'mat-khau-cu');
    await bob.register('bob11@example.com', 'mk-bob');

    const { noteId } = await alice.createNote('Note se duoc chia se sau khi doi mat khau');
    await alice.changePassword('mat-khau-cu', 'mat-khau-moi');

    const { shareId } = await alice.shareNote(noteId, 'bob11@example.com');
    const text = await bob.readSharedNote(shareId);
    expect(text).toBe('Note se duoc chia se sau khi doi mat khau');
  });

  test('email khong phan biet hoa/thuong va khoang trang (chuan hoa truoc khi gui)', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    await alice.register('  Alice12@Example.com  ', 'mat-khau-cua-alice');
    expect(alice.currentUserEmail()).toBe('alice12@example.com');
    alice.logout();

    const alice2 = new SecureNoteClient(transport);
    await alice2.login('ALICE12@EXAMPLE.COM', 'mat-khau-cua-alice');
    expect(alice2.isLoggedIn()).toBe(true);
  });

  test('logout() xoa khoa khoi bo nho (memzero) - khoa cu tro thanh toan so 0', async () => {
    const transport = createMemoryTransport();
    const alice = new SecureNoteClient(transport);
    await alice.register('alice13@example.com', 'mat-khau-cua-alice');
    const masterKeyRef = alice._session.masterKey;
    expect(masterKeyRef.some((byte) => byte !== 0)).toBe(true);

    alice.logout();
    expect(masterKeyRef.every((byte) => byte === 0)).toBe(true);
  });
});
