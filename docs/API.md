# Hợp đồng API

Thay thế `HANDOFF_FOR_B.md`. **Lâm và Trần Bảo cùng sửa file này**; đổi API thì cập nhật file này và
schema trong `shared/src/schemas.js` trong cùng một PR.

## Quy ước chung

- Mọi đường dẫn có tiền tố `/api`.
- Body và response là JSON. Nhị phân dạng base64url không padding.
- Danh tính lấy từ cookie phiên (`httpOnly`, `Secure`, `SameSite=Strict`), không lấy từ body hay URL.
- Route cần đăng nhập xác thực **trước** khi đọc body: thiếu phiên luôn là `401 UNAUTHENTICATED`, kể cả
  khi body sai hoặc quá lớn (D47).
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
- `kdfParams` phải nằm trong khoảng `[KDF_MINIMUMS, KDF_MAXIMUMS]` (`shared/src/config.js`): tối thiểu
  `opslimit = 2`, `memlimit = 19 MiB`; tối đa `opslimit = 16`, `memlimit = 1 GiB` (D48).
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

Lỗi: `401 INVALID_CREDENTIALS` nếu `oldAuthKey` sai (**không** đổi gì cả), `400 VALIDATION_ERROR`,
`429 RATE_LIMITED` (5 lần / 15 phút). Thành công trả `204`; phiên hiện tại được giữ, mọi phiên khác của
người này bị hủy trong cùng một transaction (D25, D52).

> Lưu ý cho giao diện: `INVALID_CREDENTIALS` ở route này là `401` **dù người dùng vẫn đang đăng nhập**.
> Đừng coi mọi `401` là "hết phiên"; hãy xem `code`: chỉ `UNAUTHENTICATED` mới nghĩa là phải đăng nhập lại.

### GET /api/users/:email/salt

Không cần đăng nhập. Trả `{ salt, kdfParams }` để client dẫn xuất khóa bằng đúng tham số Argon2id đã
dùng lúc đăng ký (D13). Email chưa đăng ký vẫn trả `200` với salt giả, cố định theo email và trông y
hệt salt thật (D15), nên không dò được ai đã có tài khoản.

### POST /api/login

Schema: `LoginRequest` → `SelfAccountResponse`.

```json
{ "email": "lam@example.com", "authKey": "<32 byte>" }
```

- Thành công: `200`, body là khóa đã bọc của chính người gọi (server không mở được), kèm
  `Set-Cookie: __Host-sid=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`.
- Sai `authKey` **và** email không tồn tại đều trả `401 INVALID_CREDENTIALS` với cùng thông điệp.
- Đăng nhập luôn cấp token mới; nếu request mang theo cookie phiên cũ thì phiên đó bị hủy (D44).
- Mọi lần thử, cả thất bại, được ghi vào `LoginHistory`.
- Phiên hết hạn tuyệt đối sau 24 giờ, không tự gia hạn (D43).

### POST /api/logout và GET /api/me

Cần cookie phiên; thiếu hoặc sai thì `401 UNAUTHENTICATED`. `logout` trả `204`, xóa phiên ở server và
xóa cookie. `me` trả `SelfAccountResponse`, giống body của login.

### Giới hạn tần suất

Tính theo IP (`RATE_LIMITS` trong `shared/src/config.js`); vượt ngưỡng trả `429 RATE_LIMITED`. Chưa có
giới hạn theo từng tài khoản.

| Route                        | Ngưỡng           |
| ---------------------------- | ---------------- |
| `POST /api/register`         | 5 lần / 15 phút  |
| `POST /api/login`            | 10 lần / 15 phút |
| `GET /api/users/:email/salt` | 30 lần / 15 phút |
| `POST /api/change-password`  | 5 lần / 15 phút  |
| `GET /api/users/:email/keys` | 60 lần / 15 phút |

Server sau reverse proxy phải đặt `TRUST_PROXY=true` (D46), nếu không mọi request có cùng IP.

## Note

Mọi route đều cần đăng nhập. Chủ note lấy từ phiên, không nhận từ body (D16).

| Method | Đường dẫn               | Ghi chú                                                                                                    |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST   | `/api/notes`            | **NoteCreateRequest** → `201` **NoteWriteResponse**                                                        |
| GET    | `/api/notes`            | **NoteListResponse**: note của mình, có `encryptedTitle` và `wrappedNoteKey`, KHÔNG có nội dung            |
| GET    | `/api/notes/:id`        | **NoteResponse**. Chủ note hoặc người có gói chia sẻ; xem bên dưới                                         |
| PUT    | `/api/notes/:id`        | **NoteUpdateRequest** → **NoteWriteResponse**; version phải = hiện tại + 1, sai thì `409 VERSION_CONFLICT` |
| DELETE | `/api/notes/:id`        | Chỉ chủ note; `204`                                                                                        |
| POST   | `/api/notes/:id/rotate` | **RotateRequest** → **NoteWriteResponse**. Thu hồi quyền: xem bên dưới; một transaction                    |

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

### POST /api/notes/:id/rotate

Thu hồi quyền truy cập theo D24. Client sinh noteKey **mới**, mã hóa lại tiêu đề và nội dung, bọc noteKey
mới bằng Vault Key, rồi gửi kèm một gói chia sẻ mới cho **mỗi** người còn được quyền (D50).

```json
{
  "version": 2,
  "encryptedTitle": { "nonce": "...", "ciphertext": "..." },
  "encryptedContent": { "nonce": "...", "ciphertext": "..." },
  "wrappedNoteKey": { "nonce": "...", "ciphertext": "..." },
  "shares": [
    {
      "recipientEmail": "bob@example.com",
      "sharePackage": {
        "ephemeralPublicKey": "...",
        "nonce": "...",
        "ciphertext": "...",
        "signature": "..."
      }
    }
  ]
}
```

- `version` phải đúng bằng version hiện tại + 1, sai thì `409 VERSION_CONFLICT`.
- Tập người nhận sau khi xoay khóa **đúng bằng** danh sách `shares`: ai không có trong danh sách bị xóa
  quyền, ai có thì được thay bằng gói chia sẻ mới. Danh sách rỗng là thu hồi quyền của tất cả mọi người.
- Chỉ chủ note; người khác (kể cả người đang được chia sẻ) nhận `404 NOT_FOUND`.
- Một người nhận không tồn tại thì `404`; chính mình, hoặc email lặp (kể cả khác hoa/thường) thì
  `400`; tối đa `LIMITS.MAX_ROTATE_SHARES` (50) người nhận.
- **Nguyên tử:** hoặc mọi thay đổi (khóa mới, nội dung, danh sách share) cùng có hiệu lực, hoặc không có
  gì thay đổi. Server không thể tự kiểm tra chữ ký hay nội dung của gói chia sẻ; việc đó thuộc về client.

## Chia sẻ

Mọi route đều cần đăng nhập — kể cả tra khóa công khai, để người lạ không dùng nó dò xem email nào
đã có tài khoản.

| Method | Đường dẫn                | Ghi chú                                                                    |
| ------ | ------------------------ | -------------------------------------------------------------------------- |
| GET    | `/api/users/:email/keys` | **UserKeysResponse**; email không tồn tại trả `404 NOT_FOUND`              |
| POST   | `/api/notes/:id/shares`  | **ShareCreateRequest** → **ShareCreatedResponse**; chỉ chủ note            |
| GET    | `/api/notes/:id/shares`  | **NoteShareListResponse**: note của mình đang chia sẻ cho ai; chỉ chủ note |
| GET    | `/api/shares`            | **ShareListResponse**: gói chia sẻ gửi cho mình (người nhận lấy từ phiên)  |
| DELETE | `/api/shares/:id`        | Chỉ người gửi; `204`                                                       |

`sharePackage` = `{ ephemeralPublicKey, nonce, ciphertext, signature }`, chữ ký bao gồm noteId.

Chia sẻ lại cùng một note cho cùng một người là **thay** gói cũ, không tạo bản ghi mới (Prisma có
`@@unique([noteId, recipientId])`). Cần như vậy để xoay khóa note khi thu hồi quyền (D24).

Người nhận đọc nội dung qua `GET /api/notes/:noteId`, **không** có route `GET /api/shares/:id`:
`GET /api/shares` chỉ trả tham chiếu (`noteId`) chứ không trả ciphertext của note.

- `POST /api/notes/:id/shares` trả `201` cả khi tạo mới lẫn khi thay gói cũ. Người nhận phải là tài khoản
  đã tồn tại, nếu không `404` — nghĩa là người đã đăng nhập dò được một email có tài khoản hay không;
  giảm nhẹ bằng rate limit của `/users/:email/keys`.
- `DELETE /api/shares/:id` chỉ chặn lần đọc **sau** qua API. Nó **không** thu hồi được khóa mà người nhận
  đã giải mã và có thể đã giữ lại; muốn thu hồi thật sự phải xoay khóa note (`rotate`, D24, D53).
- `GET /api/notes/:id/shares` chỉ trả `{ id, recipientEmail, createdAt }`, không trả gói chia sẻ. Cần để
  gỡ chia sẻ (lấy `id`) và để xoay khóa (biết danh sách người còn quyền, D50). Người được chia sẻ gọi
  route này nhận `404`: họ không được biết note còn chia sẻ cho ai khác (D60).
- `GET /api/notes` và `GET /api/shares` chưa phân trang: trả toàn bộ.

## Giới hạn kích thước

Server kiểm tra hình dạng dữ liệu đã mã hóa chặt hơn là chỉ "là chuỗi base64url" (D49):

| Trường                        | Giới hạn                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| Toàn bộ request               | 1 MB (`LIMITS.MAX_REQUEST_BYTES`), vượt thì `413 PAYLOAD_TOO_LARGE`      |
| `nonce` của mọi `Sealed`      | Đúng 24 byte                                                             |
| `ciphertext` của mọi `Sealed` | Ít nhất một tag xác thực (16 byte)                                       |
| `encryptedTitle`              | Bản rõ tối đa 1024 byte (`LIMITS.MAX_NOTE_TITLE_BYTES`) + 16 byte tag    |
| `encryptedContent`            | Bản rõ tối đa 512 KB (`LIMITS.MAX_NOTE_PLAINTEXT_BYTES`) + 16 byte tag   |
| Khóa đã bọc (`wrapped*`)      | Bản rõ tối đa 128 byte (`LIMITS.MAX_WRAPPED_KEY_BYTES`) + 16 byte tag    |
| `sharePackage`                | Khóa ephemeral 32 byte, nonce 24 byte, chữ ký 64 byte, ciphertext ≤ trần |

Client cũng tự chặn tiêu đề và nội dung vượt giới hạn trước khi mã hóa (D28); độ dài tính theo **byte
UTF-8**, không phải số ký tự.

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
