# Quản lý khóa

Chính sách vòng đời của mọi khóa trong hệ thống (ASVS 11.1.1), đối chiếu với các giai đoạn của
NIST SP 800-57 Part 1: **sinh** (pre-operational), **dùng và lưu** (operational), **thay/xoay**, và
**hủy** (destroyed). Hệ thống không có giai đoạn lưu trữ lâu dài (archive) cho khóa nào.

Nguyên tắc chung:

- **Khóa bí mật chỉ tồn tại dạng rõ trong bộ nhớ của tab trình duyệt.** Không ghi ra `localStorage`,
  `sessionStorage`, IndexedDB hay cookie (CLAUDE.md). Tải lại trang là mất, phải đăng nhập lại.
- **Máy chủ chỉ giữ khóa đã bọc** (AEAD XChaCha20-Poly1305) hoặc khóa công khai; không mở được gì.
- **Mọi số ngẫu nhiên** lấy từ CSPRNG của libsodium (`randombytes_buf`, `crypto_box_keypair`,
  `crypto_sign_keypair`); phía máy chủ dùng `crypto.randomBytes` của Node.
- **Hủy = ghi đè bằng 0** (`sodium.memzero`) ngay khi hết dùng, thay vì chờ garbage collector. Có test
  kiểm tra các khóa quan trọng thật sự về 0 (xem cột "Hủy").
- **Không chia sẻ quá mức** (yêu cầu của 11.1.1): khóa riêng chỉ một bên giữ; khóa đối xứng dùng chung
  (khóa note) chỉ chủ note và đúng những người được chia sẻ giữ.

## Bảng khóa

Tất cả khóa đối xứng dài 32 byte (256 bit).

| Khóa                                  | Loại (SP 800-57)                        | Sinh ra                                                                          | Ai giữ, ở đâu                                                                                             | Thay / xoay                                                                                             | Hủy                                                                                               |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| rootKey                               | Khóa dẫn xuất từ mật khẩu               | Argon2id(mật khẩu, salt 16 byte ngẫu nhiên, `KDF_DEFAULTS`) trong trình duyệt    | Chỉ tồn tại trong lúc tách khóa                                                                           | Theo mật khẩu                                                                                           | `memzero` ngay sau khi tách ra authKey và masterKey (`crypto/src/kdf.js`)                         |
| authKey                               | Bí mật xác thực                         | `crypto_kdf` từ rootKey, ngữ cảnh `SNauth01`                                     | Gửi lên máy chủ khi đăng nhập / nhập lại mật khẩu; máy chủ chỉ lưu SHA-256 (D14)                          | Đổi khi đổi mật khẩu                                                                                    | `memzero` ngay sau request, cả khi thành công lẫn thất bại (test "vệ sinh bộ nhớ khi đăng nhập")  |
| masterKey                             | Khóa bọc khóa (KEK)                     | `crypto_kdf` từ rootKey, ngữ cảnh `SNenc001`                                     | Bộ nhớ tab trong suốt phiên làm việc                                                                      | Đổi khi đổi mật khẩu (salt mới); các khóa bên dưới được bọc lại, không mã hóa lại note nào (D25)        | Đăng xuất, tự khóa sau 15 phút (D71), xóa tài khoản; thất bại khi đăng nhập/đăng ký cũng xóa ngay |
| vaultKey                              | Khóa bọc khóa (KEK)                     | Ngẫu nhiên, một lần khi đăng ký                                                  | Máy chủ: bọc bằng masterKey. Bộ nhớ tab trong phiên                                                       | **Không xoay** (xem Giới hạn)                                                                           | Như masterKey; xóa tài khoản thì bản bọc trên máy chủ bị xóa                                      |
| noteKey                               | Khóa mã hóa dữ liệu (DEK), mỗi note một | Ngẫu nhiên khi tạo note                                                          | Máy chủ: bọc bằng vaultKey của chủ, và một gói chia sẻ cho mỗi người được chia sẻ. Chỉ mở ra lúc cần dùng | **Xoay khi thu hồi quyền** (D24): note được mã hóa lại bằng khóa mới, gói mới cho những người còn quyền | `memzero` sau mỗi lần dùng; xóa note / xóa tài khoản thì mọi bản bọc bị xóa                       |
| Khóa riêng X25519 (thỏa thuận khóa)   | Khóa riêng thỏa thuận khóa tĩnh         | `crypto_box_keypair` khi đăng ký                                                 | Chỉ người dùng; máy chủ giữ bản bọc bằng masterKey                                                        | **Không xoay** (xem Giới hạn)                                                                           | Như masterKey. Đăng ký thất bại thì xóa ngay (test "vệ sinh bộ nhớ khi đăng ký thất bại")         |
| Khóa riêng Ed25519 (chữ ký)           | Khóa riêng ký số                        | `crypto_sign_keypair` khi đăng ký                                                | Như X25519                                                                                                | **Không xoay**                                                                                          | Như X25519                                                                                        |
| Khóa công khai X25519, Ed25519        | Khóa công khai                          | Cùng lúc với khóa riêng                                                          | Máy chủ, để người khác tra cứu; client tự suy lại và đối chiếu khi đăng nhập (D70)                        | Theo khóa riêng                                                                                         | Xóa tài khoản                                                                                     |
| Khóa tạm (ephemeral) X25519           | Khóa riêng thỏa thuận khóa tạm          | `crypto_box_keypair`, mỗi gói chia sẻ một cặp                                    | Chỉ trong hàm bọc gói chia sẻ                                                                             | Dùng đúng một lần                                                                                       | `memzero` ngay sau ECDH (test "khóa riêng tạm thời bị xóa về 0")                                  |
| sharedSecret, wrapKey của gói chia sẻ | Bí mật dùng chung / khóa bọc tạm        | ECDH, rồi BLAKE2b(sharedSecret ‖ khóa tạm công khai ‖ khóa công khai người nhận) | Chỉ trong hàm bọc / mở gói                                                                                | Dùng đúng một lần                                                                                       | `memzero` ngay sau khi dùng                                                                       |
| Token phiên                           | Bí mật xác thực (phía máy chủ sinh)     | 32 byte `crypto.randomBytes` khi đăng nhập                                       | Cookie `__Host-sid` (HttpOnly, Secure, SameSite=Strict); DB chỉ lưu SHA-256 (D43)                         | Mới mỗi lần đăng nhập, hủy token cũ (ASVS 7.2.4)                                                        | Hết hạn tuyệt đối 24 giờ; đăng xuất; đăng xuất từ xa; đổi mật khẩu (phiên khác); xóa tài khoản    |
| `SERVER_SECRET`                       | Khóa HMAC phía máy chủ                  | Người vận hành tạo (32 byte ngẫu nhiên), đặt trong `deploy/.env`                 | Chỉ tiến trình server, qua biến môi trường; không nằm trong repo                                          | Đổi được bất cứ lúc nào; chỉ làm đổi salt giả của email chưa đăng ký (D15)                              | Thay giá trị trong `deploy/.env`                                                                  |
| Khóa TLS                              | Khóa riêng của chứng chỉ                | Caddy tự sinh (CA nội bộ cho `localhost`, Let's Encrypt cho tên miền thật)       | Volume `caddy_data` của container Caddy                                                                   | Caddy tự gia hạn trước khi chứng chỉ hết hạn                                                            | Xóa volume (`down -v`)                                                                            |

## Tham số và thuật toán

| Việc                        | Thuật toán                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Dẫn xuất khóa từ mật khẩu   | Argon2id, `opslimit = 3`, `memlimit = 64 MiB` (`KDF_DEFAULTS`), sàn `KDF_MINIMUMS` (D48) |
| Tách khóa                   | `crypto_kdf_derive_from_key` (BLAKE2b) với ngữ cảnh khác nhau                            |
| Mã hóa và bọc khóa          | XChaCha20-Poly1305 IETF, nonce 24 byte ngẫu nhiên mỗi lần                                |
| Thỏa thuận khóa khi chia sẻ | X25519 với khóa tạm, rồi BLAKE2b gắn cả hai khóa công khai                               |
| Chữ ký gói chia sẻ          | Ed25519, ký cả ngữ cảnh `secure-notes/share/v1\|noteId` (D23)                            |
| Gắn ngữ cảnh ciphertext     | Associated Data `secure-notes/note/v1\|trường\|noteId\|version` (D19)                    |

Nonce ngẫu nhiên 24 byte: xác suất trùng không đáng kể kể cả sau rất nhiều lần mã hóa bằng cùng một
khóa, nên không cần bộ đếm nonce. Nhãn `v1` trong AD và chữ ký là phiên bản định dạng; đổi thuật toán
thì dùng `v2` (D87).

Tốc độ Argon2id đo trong trình duyệt thật, xem README, mục _Benchmark Argon2id_.

## Khi có sự cố

| Sự cố                                 | Việc cần làm                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Nghi mật khẩu bị lộ                   | Đổi mật khẩu: masterKey mới, mọi phiên khác bị hủy (D25). Xem _Lịch sử_ để biết có ai đăng nhập lạ                                              |
| Nghi một thiết bị bị lấy              | _Tài khoản và bảo mật_ → đăng xuất thiết bị đó (D80), rồi đổi mật khẩu                                                                          |
| Người được chia sẻ không còn tin được | _Thu hồi quyền_ (xoay noteKey), không chỉ _Gỡ khỏi danh sách_ (D62)                                                                             |
| Lộ database                           | Chỉ lộ ciphertext, khóa đã bọc và SHA-256 của authKey / token. Kẻ tấn công phải brute-force Argon2id từng mật khẩu. Người dùng nên đổi mật khẩu |
| Lộ `SERVER_SECRET`                    | Đổi giá trị rồi khởi động lại server. Chỉ ảnh hưởng khả năng dò email qua salt giả (D15)                                                        |

## Giới hạn

- **vaultKey và cặp khóa định danh (X25519, Ed25519) không bao giờ xoay.** SP 800-57 khuyến nghị giới
  hạn thời gian dùng (cryptoperiod) cho khóa riêng dài hạn. Xoay chúng đòi hỏi bọc lại mọi noteKey và
  báo cho mọi người đã chia sẻ, nằm ngoài phạm vi đồ án. Hệ quả: không có forward secrecy cho khóa dài
  hạn (THREAT_MODEL, giới hạn 6). Đổi mật khẩu chỉ đổi lớp bọc bên ngoài.
- **`memzero` trong JavaScript không bảo đảm tuyệt đối:** chuỗi base64 và bản sao trung gian do trình
  duyệt tạo ra không xóa được, và bộ nhớ có thể đã bị hệ điều hành đưa ra đĩa. `memzero` rút ngắn thời
  gian khóa nằm trong bộ nhớ, không loại bỏ hẳn.
- **Mật khẩu người dùng nhập vào ô input** nằm trong DOM tới khi form bị hủy; không xóa được từ JavaScript.
