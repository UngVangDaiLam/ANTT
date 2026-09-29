/**
 * Chọn ĐÚNG các trường của SelfAccountResponse từ một dòng User của Prisma.
 * Liệt kê tường minh thay vì trả cả dòng: nếu sau này bảng User có thêm cột nhạy cảm
 * (authKeyHash, recoveryAuthKeyHash...) thì nó không tự lọt ra ngoài (ASVS 15.3.1).
 */
export function toSelfAccount(user) {
  return {
    email: user.email,
    wrappedVaultKey: user.wrappedVaultKey,
    x25519PublicKey: user.x25519PublicKey,
    ed25519PublicKey: user.ed25519PublicKey,
    wrappedX25519PrivateKey: user.wrappedX25519PrivateKey,
    wrappedEd25519PrivateKey: user.wrappedEd25519PrivateKey,
  };
}
