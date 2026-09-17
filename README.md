# secure-note-crypto — Module crypto (thành viên A)

Đây là khung code khởi điểm cho module `crypto/` của đồ án Secure Note E2EE, đã cài đặt, chạy test và benchmark thành công. Đọc file này trước khi bắt đầu.

## Cài đặt

```bash
npm install
npm test          # chạy 16 unit test, phải PASS hết
npm run benchmark # đo thời gian Argon2id với các memory cost khác nhau
```

## LƯU Ý QUAN TRỌNG — đã xác nhận bằng thực nghiệm

Bản `libsodium-wrappers` **thường** (không phải sumo) **không có** `crypto_pwhash` (Argon2id) — gọi sẽ báo lỗi `TypeError: length cannot be null or undefined` vì các hằng số như `crypto_pwhash_SALTBYTES` bị `undefined`. Toàn bộ code trong repo này dùng `libsodium-wrappers-sumo`. Khi tích hợp vào `client/` (React + Vite), nhớ cài đúng gói:

```bash
npm install libsodium-wrappers-sumo
```

và import giống hệt cách dùng trong Node: `import sodium from 'libsodium-wrappers-sumo'; await sodium.ready;` trước khi gọi bất kỳ hàm nào. Gói này chạy được cả trên browser (qua bundler như Vite) lẫn Node — đúng như đề xuất gốc đã kỳ vọng ("một thư viện, một API").

## Cấu trúc

```
src/
  kdf.js      Bước 1: password -> Argon2id -> root key -> tách authKey/masterKey (crypto_kdf)
  vault.js    Bước 2: sinh Vault Key, bọc/mở bằng masterKey (key wrapping 2 lớp)
  note.js     Bước 3: mã hóa/giải mã nội dung note bằng Vault Key
  sharing.js  Bước 4: chia sẻ hybrid X25519 (ECDH) + XChaCha20-Poly1305 (kiểu ECIES)
  index.js    gom export cả 4 module

test/         unit test cho từng module, gồm test "tamper ciphertext -> phải fail"
benchmark/    đo thời gian Argon2id theo memory cost (dùng cho báo cáo tuần 8)
```

## Luồng dữ liệu tổng thể (đọc theo đúng thứ tự sẽ code)

1. **Đăng ký tài khoản**: `kdf.generateSalt()` → `kdf.deriveKeysFromPassword(password, salt)` ra `{authKey, masterKey}`. Gửi `authKey` lên server (server hash thêm 1 lớp trước khi lưu — việc của thành viên B). `masterKey` giữ lại ở client.
2. Sinh `vault.generateVaultKey()`, rồi `vault.wrapVaultKey(vaultKey, masterKey)` → gửi phần đã bọc lên server lưu kèm tài khoản.
3. Sinh cặp khóa chia sẻ: `sharing.generateKeyPair()` → bọc private key bằng `sharing.wrapPrivateKey(privateKey, masterKey)` → gửi `publicKey` (để lộ, dùng cho chia sẻ) và private key đã bọc lên server.
4. **Đăng nhập**: dẫn lại `{authKey, masterKey}` từ password + salt đã lưu → gửi authKey xác thực → nếu đúng, dùng masterKey để `vault.unwrapVaultKey(...)` lấy lại Vault Key, và `sharing.unwrapPrivateKey(...)` lấy lại private key chia sẻ.
5. **Lưu note**: `note.encryptNote(text, vaultKey)` → gửi `{nonce, ciphertext}` lên server.
6. **Đọc note**: tải `{nonce, ciphertext}` về → `note.decryptNote(...)` bằng Vault Key.
7. **Chia sẻ note cho B**: lấy `publicKey` của B (từ server) → `sharing.wrapNoteKeyForRecipient(vaultKeyOrNoteKey, B.publicKey)` → gửi kết quả lên server. B tải về, dùng `sharing.unwrapNoteKeyFromSender(wrapped, B.privateKey)` để lấy lại khóa và giải mã note.

## Việc cần làm tiếp (không có trong bản khởi điểm này)

- Viết thêm test benchmark trên máy yếu thật (không chỉ giả lập) và trên mobile browser.
- Cân nhắc thêm cơ chế hiển thị fingerprint public key khi chia sẻ (đối chiếu thủ công, chống server tráo khóa) — xem ghi chú trong `sharing.js`.
- Tích hợp vào React: gọi các hàm này trong context/state quản lý phiên đăng nhập, KHÔNG lưu `masterKey`/`vaultKey`/private key vào `localStorage`.
- Khi viết báo cáo, trích trực tiếp các đoạn comment giải thích "vì sao" trong từng file — đó chính là nội dung mục "ăn điểm" (thiết kế khóa, quản lý nonce, giới hạn của thiết kế).

## Số liệu benchmark đã đo thử (môi trường phát triển hiện tại, chỉ để tham khảo)

| Memory cost | Thời gian |
|---|---|
| 16 MB | 63 ms |
| 32 MB | 100 ms |
| 64 MB | 208 ms |
| 128 MB | 418 ms |

Nhớ đo lại trên máy thật của nhóm và trên mobile — số liệu sẽ khác, và đó chính là số liệu cần đưa vào báo cáo.
