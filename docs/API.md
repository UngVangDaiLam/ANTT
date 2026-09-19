# Hợp đồng API

Thay thế `HANDOFF_FOR_B.md`. **Lâm và Trần Bảo cùng sửa file này**; đổi API thì cập nhật file này và
schema trong `shared/src/schemas.js` trong cùng một PR.

## Quy ước chung

- Mọi đường dẫn có tiền tố `/api`.
- Body và response là JSON. Nhị phân dạng base64url không padding.
- Danh tính lấy từ cookie phiên (`httpOnly`, `Secure`, `SameSite=Strict`), không lấy từ body hay URL.
- Lỗi: `{ "code": "...", "message": "..." }`, xem `shared/src/errors.js`.
- Mọi object trong request có `additionalProperties: false`: gửi thừa trường là bị từ chối.
- `Sealed` = `{ nonce, ciphertext }`, dữ liệu đã mã hóa bằng XChaCha20-Poly1305.

Các mục đánh dấu **(chốt)** cần Lâm điền chính xác tên trường theo code.

## Tài khoản

| Method | Đường dẫn                | Cần đăng nhập | Ghi chú                                                                       |
| ------ | ------------------------ | ------------- | ----------------------------------------------------------------------------- |
| POST   | `/api/register`          | Không         | Xem chi tiết bên dưới; có rate limit                                          |
| GET    | `/api/users/:email/salt` | Không         | Trả `{ salt, kdfParams }`; email chưa đăng ký vẫn trả salt giả; có rate limit |
| POST   | `/api/login`             | Không         | `{ email, authKey }` → đặt cookie, trả khóa đã bọc; có rate limit             |
| POST   | `/api/logout`            | Có            | Xóa phiên hiện tại                                                            |
| GET    | `/api/me`                | Có            | Trả email, khóa đã bọc, public key của chính mình                             |
| POST   | `/api/change-password`   | Có            | **(chốt)** authKey cũ + salt, kdfParams, authKey, Vault Key bọc lại mới       |

### POST /api/register

Schema: `RegisterRequest` trong `shared/src/schemas.js`. Tên trường theo D34.

```json
{
  "email": "lam@example.com",
  "salt": "<16 byte>",
  "kdfParams": { "opslimit": 3, "memlimit": 67108864 },
  "authKey": "<32 byte>",
  "wrappedVaultKey": { "nonce": "...", "ciphertext": "..." },
  "x25519PublicKey": "<32 byte>",
  "ed25519PublicKey": "<32 byte>",
  "wrappedX25519PrivateKey": { "nonce": "...", "ciphertext": "..." },
  "wrappedEd25519PrivateKey": { "nonce": "...", "ciphertext": "..." }
}
```

- Nhị phân là base64url không padding; server kiểm tra đúng số byte ghi trong `<...>`.
- Server chuẩn hóa `email` (trim + chữ thường) rồi mới lưu, và chỉ lưu SHA-256(`authKey`).
- Thành công: `201`, body rỗng. **Không** tạo phiên; client gọi `POST /api/login` tiếp theo.
- Lỗi: `409 EMAIL_TAKEN` (email đã có, kể cả khác hoa/thường), `400 VALIDATION_ERROR`,
  `429 RATE_LIMITED` (quá `RATE_LIMITS.REGISTER` trong `shared/src/config.js`).

## Note

| Method | Đường dẫn               | Ghi chú                                                                                                                     |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/notes`            | `{ id (UUID do client sinh), version: 1, encryptedTitle, encryptedContent, wrappedNoteKey }`                                |
| GET    | `/api/notes`            | Danh sách note của mình: `id`, `version`, `encryptedTitle`, `updatedAt` (không trả nội dung)                                |
| GET    | `/api/notes/:id`        | Chủ note hoặc người có gói chia sẻ; người nhận được trả kèm gói chia sẻ của mình                                            |
| PUT    | `/api/notes/:id`        | `{ version, encryptedTitle, encryptedContent }`, version phải = hiện tại + 1                                                |
| DELETE | `/api/notes/:id`        | Chỉ chủ note                                                                                                                |
| POST   | `/api/notes/:id/rotate` | **(chốt)** Thu hồi: nội dung, tiêu đề, khóa note bọc mới, version mới, gói chia sẻ mới cho người còn quyền; một transaction |

## Chia sẻ

| Method | Đường dẫn                | Ghi chú                                                |
| ------ | ------------------------ | ------------------------------------------------------ |
| GET    | `/api/users/:email/keys` | `{ x25519PublicKey, ed25519PublicKey }`                |
| POST   | `/api/notes/:id/shares`  | `{ recipientEmail, sharePackage }`, chỉ chủ note       |
| GET    | `/api/shares`            | Các gói chia sẻ gửi cho mình (lấy người nhận từ phiên) |
| DELETE | `/api/shares/:id`        | Chỉ người gửi                                          |

`sharePackage` = `{ ephemeralPublicKey, nonce, ciphertext, signature }`, chữ ký bao gồm noteId.

## Phiên đăng nhập

| Method | Đường dẫn            | Ghi chú                           |
| ------ | -------------------- | --------------------------------- |
| GET    | `/api/sessions`      | Các phiên đang hoạt động của mình |
| DELETE | `/api/sessions/:id`  | Đăng xuất một thiết bị            |
| GET    | `/api/login-history` | Lịch sử đăng nhập, cả thất bại    |

## Tiện ích

| Method | Đường dẫn           | Ghi chú                       |
| ------ | ------------------- | ----------------------------- |
| GET    | `/api/health`       | Kiểm tra server sống          |
| GET    | `/api/openapi.json` | Tài liệu OpenAPI sinh tự động |
