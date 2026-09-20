# Hợp đồng API

Thay thế `HANDOFF_FOR_B.md`. **Lâm và Trần Bảo cùng sửa file này**; đổi API thì cập nhật file này và
schema trong `shared/src/schemas.js` trong cùng một PR.

## Quy ước chung

- Mọi đường dẫn có tiền tố `/api`.
- Body và response là JSON. Nhị phân dạng base64url không padding.
- Danh tính lấy từ cookie phiên (`httpOnly`, `Secure`, `SameSite=Strict`), không lấy từ body hay URL.
- Lỗi: `{ "code": "...", "message": "..." }`, xem `shared/src/errors.js`.
- Mọi object trong request **và response** có `additionalProperties: false`: thừa trường là bị từ chối.
- `Sealed` = `{ nonce, ciphertext }`, dữ liệu đã mã hóa bằng XChaCha20-Poly1305.
- Tên schema in đậm ở mỗi mục là schema TypeBox trong `shared/src/schemas.js`. Đó mới là nguồn sự
  thật về hình dạng dữ liệu; bảng dưới đây chỉ để đọc nhanh. Server dùng schema đó để kiểm tra
  request, `client-sdk` dùng đúng schema đó để kiểm tra response (D06, D37).

## Tài khoản

| Method | Đường dẫn                | Cần đăng nhập | Ghi chú                                                                    |
| ------ | ------------------------ | ------------- | -------------------------------------------------------------------------- |
| POST   | `/api/register`          | Không         | **RegisterRequest** → `201` body rỗng; có rate limit                       |
| GET    | `/api/users/:email/salt` | Không         | **SaltResponse**; email chưa đăng ký vẫn trả salt giả (D15); có rate limit |
| POST   | `/api/login`             | Không         | **LoginRequest** → cookie + **SelfAccountResponse**; có rate limit         |
| POST   | `/api/logout`            | Có            | Xóa phiên hiện tại; `204`                                                  |
| GET    | `/api/me`                | Có            | **SelfAccountResponse** (giống body của login)                             |
| POST   | `/api/change-password`   | Có            | **ChangePasswordRequest** → `204`; server hủy các phiên khác (D25)         |

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

### POST /api/change-password

`oldAuthKey` chứng minh người gọi biết mật khẩu cũ — server kiểm tra nó chứ không chỉ dựa vào cookie,
nên người mượn được máy đang đăng nhập vẫn không đổi được mật khẩu (D25).

Client bọc lại Vault Key **và cả hai private key** bằng masterKey mới rồi gửi kèm; không note nào bị
đụng tới, dù tài khoản có bao nhiêu note (lợi ích của key wrapping hai lớp).

```json
{
  "oldAuthKey": "<32 byte>",
  "salt": "<16 byte>",
  "kdfParams": { "opslimit": 3, "memlimit": 67108864 },
  "authKey": "<32 byte>",
  "wrappedVaultKey": { "nonce": "...", "ciphertext": "..." },
  "wrappedX25519PrivateKey": { "nonce": "...", "ciphertext": "..." },
  "wrappedEd25519PrivateKey": { "nonce": "...", "ciphertext": "..." }
}
```

## Note

Mọi route đều cần đăng nhập. Chủ note lấy từ phiên, không nhận từ body (D16).

| Method | Đường dẫn               | Ghi chú                                                                                                                     |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/notes`            | **NoteCreateRequest** → `201` **NoteWriteResponse**                                                                         |
| GET    | `/api/notes`            | **NoteListResponse**: note của mình, có `encryptedTitle` và `wrappedNoteKey`, KHÔNG có nội dung                             |
| GET    | `/api/notes/:id`        | **NoteResponse**. Chủ note hoặc người có gói chia sẻ; xem bên dưới                                                          |
| PUT    | `/api/notes/:id`        | **NoteUpdateRequest** → **NoteWriteResponse**; version phải = hiện tại + 1, sai thì `409 VERSION_CONFLICT`                  |
| DELETE | `/api/notes/:id`        | Chỉ chủ note; `204`                                                                                                         |
| POST   | `/api/notes/:id/rotate` | **(chốt)** Thu hồi: nội dung, tiêu đề, khóa note bọc mới, version mới, gói chia sẻ mới cho người còn quyền; một transaction |

`id` do client sinh (UUID v4 — D17); id đã tồn tại thì trả `409 NOTE_ID_TAKEN`. Note của người khác
trả `404 NOT_FOUND`, không trả `403` (D30).

### GET /api/notes/:id

Cùng một route phục vụ cả chủ note lẫn người được chia sẻ (D22: chia sẻ theo tham chiếu, server
không sao chép ciphertext). Khác nhau ở đúng một trường, và luôn có đúng một trong hai:

- Chủ note nhận `wrappedNoteKey` — khóa note bọc bằng Vault Key của chính họ.
- Người được chia sẻ nhận `share: { senderEmail, sharePackage }` — client xác minh chữ ký Ed25519 của
  người gửi **trước khi** giải mã.

```json
{
  "id": "…",
  "version": 1,
  "encryptedTitle": { "nonce": "...", "ciphertext": "..." },
  "encryptedContent": { "nonce": "...", "ciphertext": "..." },
  "updatedAt": "2026-09-20T10:11:12.000Z",
  "wrappedNoteKey": { "nonce": "...", "ciphertext": "..." }
}
```

`GET /api/notes` có kèm `wrappedNoteKey` của từng dòng, vì không có nó thì client không mở nổi
`encryptedTitle` và danh sách note sẽ chỉ là một cột trống. Đó vẫn là khóa đã bọc bằng Vault Key của
người gọi nên server không đọc được gì thêm.

## Chia sẻ

Mọi route đều cần đăng nhập — kể cả tra khóa công khai, để người lạ không dùng nó dò xem email nào
đã có tài khoản.

| Method | Đường dẫn                | Ghi chú                                                                   |
| ------ | ------------------------ | ------------------------------------------------------------------------- |
| GET    | `/api/users/:email/keys` | **UserKeysResponse**; email không tồn tại trả `404 NOT_FOUND`             |
| POST   | `/api/notes/:id/shares`  | **ShareCreateRequest** → **ShareCreatedResponse**; chỉ chủ note           |
| GET    | `/api/shares`            | **ShareListResponse**: gói chia sẻ gửi cho mình (người nhận lấy từ phiên) |
| DELETE | `/api/shares/:id`        | Chỉ người gửi; `204`                                                      |

`sharePackage` = `{ ephemeralPublicKey, nonce, ciphertext, signature }`, chữ ký bao gồm noteId.

Chia sẻ lại cùng một note cho cùng một người là **thay** gói cũ, không tạo bản ghi mới (Prisma có
`@@unique([noteId, recipientId])`). Cần như vậy để xoay khóa note khi thu hồi quyền (D24).

Người nhận đọc nội dung qua `GET /api/notes/:noteId`, **không** có route `GET /api/shares/:id`:
`GET /api/shares` chỉ trả tham chiếu (`noteId`) chứ không trả ciphertext của note.

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
