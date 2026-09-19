import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Server KHÔNG lưu authKey gốc (tránh pass-the-hash khi lộ DB), chỉ lưu SHA-256 của nó.
 * authKey là 32 byte ngẫu nhiên do Argon2id + KDF sinh ra ở client, nên SHA-256 là đủ,
 * không cần băm chậm thêm lần nữa.
 * @param {string} authKeyB64 base64url không padding
 * @returns {Buffer}
 */
export function hashAuthKey(authKeyB64) {
  return createHash('sha256').update(Buffer.from(authKeyB64, 'base64url')).digest();
}

/** So sánh hằng thời gian, tránh rò rỉ qua thời gian phản hồi. */
export function verifyAuthKey(authKeyB64, storedHash) {
  const candidate = hashAuthKey(authKeyB64);
  return candidate.length === storedHash.length && timingSafeEqual(candidate, storedHash);
}
