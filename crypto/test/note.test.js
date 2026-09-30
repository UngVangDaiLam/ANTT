import { describe, test, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers-sumo';
import { encryptNote, decryptNote, noteAssociatedData } from '../src/note.js';

beforeAll(async () => {
  await sodium.ready;
});

function flipOneChar(base64Str) {
  const chars = base64Str.split('');
  const idx = Math.floor(chars.length / 2);
  chars[idx] = chars[idx] === 'A' ? 'B' : 'A';
  return chars.join('');
}

const NOTE_A = '3f2b8c1e-7a4d-4e6f-9b1a-2c5d8e0f4a6b';
const NOTE_B = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const ctx = (overrides = {}) => ({ noteId: NOTE_A, version: 1, field: 'content', ...overrides });

describe('note', () => {
  test('ma hoa roi giai ma phai ra dung noi dung ban dau', async () => {
    const key = sodium.randombytes_buf(32);
    const plaintext = 'Day la mot ghi chu bi mat!';
    const encrypted = await encryptNote(plaintext, key, ctx());
    expect(await decryptNote(encrypted, key, ctx())).toBe(plaintext);
  });

  test('hai lan ma hoa cung 1 noi dung cho ra ciphertext khac nhau (nonce ngau nhien)', async () => {
    const key = sodium.randombytes_buf(32);
    const encrypted1 = await encryptNote('Note giong het nhau', key, ctx());
    const encrypted2 = await encryptNote('Note giong het nhau', key, ctx());
    expect(encrypted1.nonce).not.toBe(encrypted2.nonce);
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
  });

  test('sai khoa -> giai ma phai that bai', async () => {
    const encrypted = await encryptNote('Bi mat quoc gia', sodium.randombytes_buf(32), ctx());
    await expect(decryptNote(encrypted, sodium.randombytes_buf(32), ctx())).rejects.toBeTruthy();
  });

  test('sua 1 byte trong DB (ciphertext) -> giai ma fail ngay', async () => {
    const key = sodium.randombytes_buf(32);
    const encrypted = await encryptNote('Noi dung quan trong', key, ctx());
    const tampered = { ...encrypted, ciphertext: flipOneChar(encrypted.ciphertext) };
    await expect(decryptNote(tampered, key, ctx())).rejects.toBeTruthy();
  });
});

describe('Associated Data (D19): server khong tra nham ciphertext duoc', () => {
  test('ciphertext cua note A dem tra ve cho note B -> that bai (du cung khoa)', async () => {
    const key = sodium.randombytes_buf(32);
    const ofA = await encryptNote('Noi dung cua A', key, ctx({ noteId: NOTE_A }));
    await expect(decryptNote(ofA, key, ctx({ noteId: NOTE_B }))).rejects.toBeTruthy();
  });

  test('ciphertext version cu nhung khai la version moi -> that bai', async () => {
    const key = sodium.randombytes_buf(32);
    const v1 = await encryptNote('Ban cu', key, ctx({ version: 1 }));
    await expect(decryptNote(v1, key, ctx({ version: 2 }))).rejects.toBeTruthy();
    // Dung version thi van mo duoc: AD khong chan ban cu hop le (viec do la cua D20).
    expect(await decryptNote(v1, key, ctx({ version: 1 }))).toBe('Ban cu');
  });

  test('trao ciphertext tieu de voi noi dung (cung khoa, cung note, cung version) -> that bai', async () => {
    const key = sodium.randombytes_buf(32);
    const title = await encryptNote('Tieu de', key, ctx({ field: 'title' }));
    const content = await encryptNote('Noi dung', key, ctx({ field: 'content' }));
    await expect(decryptNote(title, key, ctx({ field: 'content' }))).rejects.toBeTruthy();
    await expect(decryptNote(content, key, ctx({ field: 'title' }))).rejects.toBeTruthy();
  });

  test('thieu ngu canh -> bao loi ngay, KHONG am tham ma hoa khong rang buoc', async () => {
    const key = sodium.randombytes_buf(32);
    await expect(encryptNote('x', key)).rejects.toThrow(TypeError);
    await expect(encryptNote('x', key, null)).rejects.toThrow(TypeError);
    const encrypted = await encryptNote('x', key, ctx());
    await expect(decryptNote(encrypted, key)).rejects.toThrow(TypeError);
  });

  test.each([
    ['noteId khong phai UUID', { noteId: 'note-1' }],
    ['noteId viet hoa', { noteId: NOTE_A.toUpperCase() }],
    ['noteId co ky tu phan cach', { noteId: `${NOTE_A}|x` }],
    ['version = 0', { version: 0 }],
    ['version la so thuc', { version: 1.5 }],
    ['version la chuoi', { version: '1' }],
    ['field la', { field: 'body' }],
  ])('ngu canh khong hop le bi tu choi: %s', (_name, overrides) => {
    expect(() => noteAssociatedData(ctx(overrides))).toThrow(TypeError);
  });

  test('AD khac nhau cho moi ngu canh khac nhau (khong trung lap)', () => {
    const variants = [
      ctx(),
      ctx({ noteId: NOTE_B }),
      ctx({ version: 2 }),
      ctx({ version: 11 }),
      ctx({ field: 'title' }),
    ].map((c) => sodium.to_hex(noteAssociatedData(c)));
    expect(new Set(variants).size).toBe(variants.length);
  });
});
