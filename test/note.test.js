const sodium = require('libsodium-wrappers-sumo');
const { encryptNote, decryptNote } = require('../src/note');

beforeAll(async () => {
  await sodium.ready;
});

function flipOneChar(base64Str) {
  const chars = base64Str.split('');
  const idx = Math.floor(chars.length / 2);
  chars[idx] = chars[idx] === 'A' ? 'B' : 'A';
  return chars.join('');
}

describe('note', () => {
  test('ma hoa roi giai ma phai ra dung noi dung ban dau', async () => {
    const vaultKey = sodium.randombytes_buf(32);
    const plaintext = 'Day la mot ghi chu bi mat!';
    const encrypted = await encryptNote(plaintext, vaultKey);
    const decrypted = await decryptNote(encrypted, vaultKey);
    expect(decrypted).toBe(plaintext);
  });

  test('hai lan ma hoa cung 1 noi dung cho ra ciphertext khac nhau (nonce ngau nhien)', async () => {
    const vaultKey = sodium.randombytes_buf(32);
    const plaintext = 'Note giong het nhau';
    const encrypted1 = await encryptNote(plaintext, vaultKey);
    const encrypted2 = await encryptNote(plaintext, vaultKey);
    expect(encrypted1.nonce).not.toBe(encrypted2.nonce);
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
  });

  test('sai vault key -> giai ma phai that bai', async () => {
    const vaultKey = sodium.randombytes_buf(32);
    const wrongKey = sodium.randombytes_buf(32);
    const encrypted = await encryptNote('Bi mat quoc gia', vaultKey);
    await expect(decryptNote(encrypted, wrongKey)).rejects.toBeTruthy();
  });

  test('sua 1 byte trong DB (ciphertext) -> giai ma fail ngay (dung nhu de xuat da mo ta)', async () => {
    const vaultKey = sodium.randombytes_buf(32);
    const encrypted = await encryptNote('Noi dung quan trong', vaultKey);
    const tampered = { ...encrypted, ciphertext: flipOneChar(encrypted.ciphertext) };
    await expect(decryptNote(tampered, vaultKey)).rejects.toBeTruthy();
  });

    test('mã hóa note rỗng vẫn phải giải mã ra đúng chuỗi rỗng', async () => {
    const vaultKey = sodium.randombytes_buf(32);
    const plaintext = '';   // <-- chuỗi rỗng, tự gõ đúng 2 dấu nháy đơn liền nhau
    const encrypted = await encryptNote(plaintext, vaultKey);
    const decrypted = await decryptNote(encrypted, vaultKey);
    expect(decrypted).toBe(plaintext);   // <-- so sánh decrypted với plaintext
  });

  test('note tiếng Việt có dấu phải mã hóa/giải mã đúng (test Unicode)', async () => {
    const vaultKey = sodium.randombytes_buf(32);
    const plaintext = 'Đây là ghi chú có dấu: ăâêôơư, thanh điệu: sắc huyền hỏi ngã nặng';
    const encrypted = await encryptNote(plaintext, vaultKey);   // <-- gọi hàm mã hóa
    const decrypted = await decryptNote(encrypted, vaultKey);   // <-- gọi hàm giải mã
    expect(decrypted).toBe(plaintext);
  });

  
});
