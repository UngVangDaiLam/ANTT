# Threat model

Giả định xuyên suốt của đồ án: **máy chủ không tin cậy**. Tài liệu này nói rõ điều đó nghĩa là gì —
bảo vệ được những gì, và quan trọng không kém, **không** bảo vệ được những gì.

## 1. Tài sản cần bảo vệ

Mức bảo vệ dùng cho cả `docs/ASVS.md` (yêu cầu 14.1.1, 14.1.2):

- **Tối mật** — lộ là mất toàn bộ nội dung. Không bao giờ rời trình duyệt ở dạng thô, không bao giờ
  ghi ra đĩa, xóa khỏi RAM bằng `sodium.memzero` khi đăng xuất.
- **Mật** — lộ là mất nội dung của một phần dữ liệu, hoặc mở đường tấn công tiếp.
- **Nội bộ** — không bí mật với chủ sở hữu nhưng không công khai.

| Tài sản                     | Mức     | Ở đâu                                                     | Vì sao                                                                              |
| --------------------------- | ------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Mật khẩu người dùng         | Tối mật | Chỉ trong RAM trình duyệt, trong thời gian nhập           | Suy ra được masterKey, tức là mở được mọi thứ                                       |
| masterKey                   | Tối mật | RAM trình duyệt (`_session`)                              | Mở được vaultKey và cả hai private key                                              |
| vaultKey                    | Tối mật | RAM trình duyệt; trên server là bản đã bọc bằng masterKey | Mở được noteKey của mọi note                                                        |
| noteKey (mỗi note một khóa) | Tối mật | RAM khi đang mở note; trên server là bản đã bọc           | Mở được một note cụ thể                                                             |
| Private key X25519          | Tối mật | RAM; trên server là bản đã bọc                            | Mở được note người khác chia sẻ cho mình                                            |
| Private key Ed25519         | Tối mật | RAM; trên server là bản đã bọc                            | Giả mạo được chữ ký người gửi                                                       |
| Nội dung và tiêu đề note    | Tối mật | Server chỉ có ciphertext                                  | Chính là thứ người dùng muốn giữ kín                                                |
| authKey                     | Mật     | Gửi lên server khi đăng nhập; server lưu SHA-256          | Đăng nhập được vào tài khoản — nhưng **không** giải mã được gì (D12 tách khóa)      |
| Session token               | Mật     | Cookie `httpOnly`; DB lưu SHA-256 của token               | Mạo danh được phiên đăng nhập, nhưng không có masterKey nên vẫn không đọc được note |
| `SERVER_SECRET`             | Mật     | Biến môi trường của server                                | Lộ thì salt giả (D15) đoán được, mất khả năng chống dò email                        |
| Public key X25519 / Ed25519 | Nội bộ  | Server lưu dạng thô                                       | Công khai theo thiết kế; rủi ro là bị **tráo**, không phải bị đọc                   |
| Metadata (xem mục 5)        | Nội bộ  | Server thấy hết                                           | Không giấu được trong kiến trúc này, phải nói rõ trong báo cáo                      |

## 2. Giả định

**Tin cậy:**

- Trình duyệt và máy của người dùng sạch: không keylogger, không extension độc hại.
- libsodium cài đặt đúng các nguyên thủy mật mã. Cả hệ thống không tự viết nguyên thủy nào (D32).
- CSPRNG của trình duyệt (`randombytes_buf`, `crypto.randomUUID`) thực sự ngẫu nhiên.
- Khi deploy có TLS thật, do Caddy cấp qua Let's Encrypt.
- **Mã JavaScript nhận được ở lần tải đầu tiên là mã trung thực.** Đây là giả định yếu nhất và không
  gỡ được — xem mục 4.

**Không tin cậy:**

- Máy chủ: cả người vận hành lẫn kẻ chiếm được quyền. Nó lưu và trung chuyển dữ liệu, không được biết
  nội dung.
- Cơ sở dữ liệu, bản sao lưu, log của server.
- Đường truyền mạng.

Ranh giới "server không chạm được vào mật mã" không phải lời hứa suông: `.dependency-cruiser.cjs`
chặn `server/` import `crypto/`, `client-sdk/` hay libsodium, và CI chạy kiểm tra này mỗi lần push.

## 3. Kẻ tấn công

| Kẻ tấn công          | Khả năng                                                                                                   | Phòng thủ                                                                                                                                                                                                                                                                                                                                                                                                                                 | Phụ trách |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Server tò mò         | Đọc toàn bộ CSDL, mọi request đi qua, mọi log                                                              | Mã hóa đầu cuối: nội dung và tiêu đề đều là ciphertext XChaCha20-Poly1305; khóa gửi lên đều đã bọc. Ranh giới kiến trúc kiểm bằng `pnpm depcheck`. Server không có đường nào chạm tới khóa                                                                                                                                                                                                                                                | Lâm       |
| Server độc hại       | Sửa dữ liệu trả về, tráo public key của người khác, phát lại ciphertext cũ, gán gói chia sẻ sang note khác | Client kiểm tra mọi response bằng chính schema server dùng (`client-sdk/src/assertSchema.js`); giải mã AEAD thất bại nếu ciphertext bị sửa; `publicKeyFingerprint()` để hai bên đối chiếu thủ công; client từ chối tham số Argon2id dưới sàn nên server không ép hạ cấp xuống mức yếu nhất (D48). Kiểm chứng bằng test tích hợp đóng vai server độc hại (`integration/test/sdk-server.test.js`). **Còn thiếu: D19, D20, D23**             | Lâm       |
| Kẻ trộm database     | Có toàn bộ bảng User, Note, Share, Session                                                                 | Không có mật khẩu, chỉ có SHA-256(authKey) nên không đăng nhập ngược được; note là ciphertext; khóa riêng đã bọc bằng masterKey mà DB không có. Session lưu dạng băm nên không dựng lại được cookie                                                                                                                                                                                                                                       | Trần Bảo  |
| Kẻ nghe lén mạng     | Đọc và sửa gói tin trên đường truyền                                                                       | TLS (Caddy, Let's Encrypt) + HSTS. Kể cả khi hạ được TLS, nội dung vẫn là ciphertext — TLS ở đây là lớp thứ hai chứ không phải lớp duy nhất                                                                                                                                                                                                                                                                                               | Trần Bảo  |
| Kẻ dò mật khẩu       | Thử mật khẩu qua API, hoặc brute-force offline sau khi trộm DB                                             | Argon2id `opslimit=3`, `memlimit=64MB` (≈330 ms/lần thử trên máy phát triển) khiến brute-force offline đắt đỏ; rate limit theo IP cho `/register`, `/login`, `/users/:email/salt`; salt giả cho email chưa đăng ký (D15) và một lỗi duy nhất cho "email lạ" lẫn "sai mật khẩu". client chặn mật khẩu dưới 8 ký tự và 3000 mật khẩu phổ biến nhất (D63). **Còn thiếu: giới hạn theo từng tài khoản (nhiều IP vẫn thử được một tài khoản)** | Trần Bảo  |
| XSS                  | Chạy JavaScript tùy ý trong origin của ứng dụng → đọc được masterKey trong RAM                             | CSP không có `unsafe-inline`/`unsafe-eval` (`deploy/Caddyfile`); React tự escape; cấm `dangerouslySetInnerHTML`, `eval`, `new Function` (ESLint + `CLAUDE.md`); note hiển thị dạng văn bản thuần; khóa không nằm trong `localStorage`                                                                                                                                                                                                     | Trần Bảo  |
| Thư viện npm độc hại | Chèn mã đánh cắp khóa qua một phụ thuộc bất kỳ                                                             | `pnpm-lock.yaml` khóa phiên bản; `pnpm audit --audit-level high` trong CI; quy tắc không thêm thư viện mới khi chưa hỏi; CSP `connect-src 'self'` chặn gửi dữ liệu ra ngoài; ranh giới kiến trúc thu hẹp số package chạm được vào khóa                                                                                                                                                                                                    | Trần Bảo  |
| Prototype Pollution  | Gửi JSON chứa `__proto__` hoặc `constructor.prototype` để đổi hành vi chương trình                         | Fastify `onProtoPoisoning: 'error'` và `onConstructorPoisoning: 'error'`; Node chạy với `--disable-proto=throw`; mọi schema `additionalProperties: false` nên trường lạ bị từ chối chứ không bị âm thầm xóa (D31); ESLint `no-proto`                                                                                                                                                                                                      | Trần Bảo  |

## 4. Những gì hệ thống KHÔNG bảo vệ được

Nói thẳng những giới hạn này quan trọng ngang với việc liệt kê phòng thủ.

1. **Server gửi mã JavaScript độc ngay từ đầu.** Đây là giới hạn căn bản của mọi ứng dụng E2EE chạy
   trên web: người dùng tải mã từ chính máy chủ mà họ không tin. Một server độc hại có thể phục vụ
   bản JS gửi masterKey về cho nó. Ứng dụng gốc kiểu Signal không có vấn đề này vì mã được ký và
   phân phối qua kho ứng dụng. CSP và Subresource Integrity chỉ giảm nhẹ, không giải quyết.
2. **XSS là mất tất cả.** Khóa nằm trong RAM của tab; mã JS chạy trong cùng origin đọc được hết.
   Mọi phòng thủ XSS ở mục 3 là bắt buộc, không phải tùy chọn.
3. **Máy người dùng bị nhiễm mã độc** (keylogger, extension đọc RAM) — ngoài phạm vi.
4. **Rollback ở lần đọc đầu tiên trên thiết bị mới.** D20 cho client nhớ version cao nhất từng thấy,
   nhưng thiết bị mới chưa có gì để so sánh, nên server có thể đưa một bản cũ. _Hiện tại D19 và D20
   đều chưa cài đặt, nên chưa có chống rollback ở bất kỳ đâu._
5. **Thu hồi không lấy lại được thứ đã đọc.** Xoay khóa note (D24) chặn lần đọc sau, nhưng người nhận
   có thể đã lưu nội dung. Không cơ chế kỹ thuật nào sửa được điều này.
6. **Không có forward secrecy cho khóa dài hạn.** Cặp X25519 của người dùng là tĩnh; nếu private key
   lộ về sau, các gói chia sẻ cũ bị bắt được trước đó có thể giải mã ngược.
7. **Tráo public key khi người dùng không đối chiếu fingerprint.** Server có thể đưa public key của
   chính nó thay vì của người nhận thật. `getFingerprint()` chỉ có tác dụng nếu hai người thật sự
   gọi điện đối chiếu — một phòng thủ thủ công, phụ thuộc thói quen người dùng.
8. **Quên mật khẩu là mất dữ liệu.** Không ai khôi phục được, kể cả người vận hành. Recovery key
   (D27) vẫn chưa làm.
9. **Tính sẵn sàng không được bảo vệ.** Server có thể xóa note, từ chối phục vụ, hoặc trả về danh
   sách thiếu. Hệ thống bảo vệ tính bí mật và toàn vẹn, không bảo vệ việc dữ liệu luôn còn đó.
10. **Server độc hại vẫn hạ được tham số Argon2id xuống đúng mức sàn.** Client dẫn xuất khóa bằng
    tham số do server trả trong `/salt`. Sàn (t = 2, m = 19 MiB, D48) chặn kiểu tấn công "trả tham số
    rác để dò mật khẩu tức thì", nhưng server vẫn trả được đúng mức sàn, yếu hơn `KDF_DEFAULTS`
    (t = 3, m = 64 MiB). Client không phân biệt được với một tài khoản cũ hợp lệ (D13 cho phép tham số
    khác nhau theo từng người). Muốn chặn hẳn phải ghim tham số ở client, đánh đổi bằng việc mất khả năng
    nâng tham số cho tài khoản cũ. Đã chọn giữ khả năng nâng cấp.
11. **Người đã đăng nhập dò được email nào có tài khoản.** Chia sẻ note cho một email không tồn tại trả
    `404`, và `/users/:email/keys` cũng vậy. Giảm nhẹ bằng bắt buộc đăng nhập và rate limit 60 lần / 15
    phút, nhưng không loại bỏ được: chia sẻ note đòi hỏi biết người nhận có tồn tại hay không.
12. **Metadata lộ gần như toàn bộ** — xem mục 5.

## 5. Metadata server vẫn thấy

Kể cả khi mọi thứ ở trên hoạt động đúng, server vẫn biết:

- **Danh tính:** email của mọi người dùng, thời điểm đăng ký.
- **Hành vi đăng nhập:** thời điểm, địa chỉ IP, user agent, lịch sử thành công/thất bại (model
  `LoginHistory` được thiết kế để ghi đúng những thứ này).
- **Đồ hình xã hội:** ai chia sẻ note nào cho ai, vào lúc nào. Đây thường là thứ lộ nhiều nhất —
  biết A chia sẻ tài liệu cho B lúc nửa đêm đã là thông tin có giá trị, dù không đọc được nội dung.
- **Thói quen dùng:** số lượng note, thời điểm tạo và mỗi lần sửa, số lần sửa (qua `version`).
- **Kích thước nội dung:** độ dài ciphertext xấp xỉ độ dài bản rõ vì XChaCha20 là stream cipher và
  hệ thống không chèn padding. Một note 20 byte phân biệt rõ với note 200 KB.
- **Tham số mật mã:** salt và `kdfParams` của từng người, public key của mọi người.

Giấu được metadata này cần padding, mạng trộn (mix network) hoặc private information retrieval —
nằm ngoài phạm vi đồ án. Điều bắt buộc là **nói rõ trong báo cáo** thay vì để người đọc tưởng E2EE
giấu được mọi thứ.

## 6. Bảng kê khóa và vòng đời

Phục vụ yêu cầu 11.1.1 và 11.1.2 của ASVS.

| Khóa                  | Thuật toán, kích thước        | Sinh ra ở đâu                            | Server lưu gì                           | Được bọc bởi | Vòng đời                                                              |
| --------------------- | ----------------------------- | ---------------------------------------- | --------------------------------------- | ------------ | --------------------------------------------------------------------- |
| Root key              | Argon2id → 32 byte            | Trình duyệt, từ mật khẩu + salt          | Không lưu                               | —            | Chỉ tồn tại trong một lời gọi hàm, `memzero` ngay sau khi tách (D12)  |
| authKey               | `crypto_kdf` BLAKE2b, 32 byte | Tách từ root key, context `SNauth01`     | SHA-256(authKey)                        | —            | Đổi khi đổi mật khẩu                                                  |
| masterKey             | `crypto_kdf` BLAKE2b, 32 byte | Tách từ root key, context `SNenc001`     | Không lưu                               | —            | Trong RAM suốt phiên; `memzero` khi đăng xuất                         |
| vaultKey              | Ngẫu nhiên, 32 byte           | Trình duyệt, một lần khi đăng ký         | `wrappedVaultKey`                       | masterKey    | Không đổi trọn đời tài khoản; chỉ **bọc lại** khi đổi mật khẩu (D25)  |
| noteKey               | Ngẫu nhiên, 32 byte           | Trình duyệt, mỗi note một khóa           | `wrappedNoteKey`                        | vaultKey     | Xoay khi thu hồi quyền chia sẻ (D24)                                  |
| X25519 (cặp)          | Curve25519, 32 byte           | Trình duyệt, một lần khi đăng ký         | Public thô + `wrappedX25519PrivateKey`  | masterKey    | Bọc lại khi đổi mật khẩu                                              |
| Ed25519 (cặp)         | Ed25519, 32 byte              | Trình duyệt, một lần khi đăng ký         | Public thô + `wrappedEd25519PrivateKey` | masterKey    | Bọc lại khi đổi mật khẩu                                              |
| Khóa ephemeral X25519 | Curve25519, 32 byte           | Trình duyệt, mỗi lần chia sẻ một cặp mới | Chỉ public key, trong `sharePackage`    | —            | Dùng một lần rồi bỏ                                                   |
| Session token         | CSPRNG, 256 bit               | Server, khi đăng nhập                    | SHA-256 của token                       | —            | Hết hạn sau `SESSION.TTL_MS` (24 giờ) hoặc khi đăng xuất              |
| `SERVER_SECRET`       | Ngẫu nhiên, 32 byte           | Người vận hành sinh khi triển khai       | Biến môi trường                         | —            | Đổi thì mọi salt giả đổi theo — chấp nhận được vì salt giả không thật |

**Nguyên tắc xuyên suốt:** không khóa nào rời trình duyệt ở dạng thô. Mọi khóa gửi lên server đều đã
qua một lớp AEAD với khóa mà server không có. Đây là lý do đổi mật khẩu chỉ cần bọc lại ba khóa
32 byte thay vì mã hóa lại toàn bộ note.
