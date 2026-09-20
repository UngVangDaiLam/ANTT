# Đối chiếu OWASP ASVS 5.0.0

Chuẩn đối chiếu đã chốt ở D09. Mã yêu cầu và nội dung lấy từ bản phát hành chính thức
[OWASP/ASVS v5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/en) (17 chương, 345 yêu cầu).

## Phạm vi đối chiếu

Đồ án nhắm **Level 1**, cộng thêm các yêu cầu **Level 2 của chương V11 (Cryptography) và V14 (Data
Protection)** vì đó là phần cốt lõi của mô hình mã hóa đầu cuối — bỏ qua chúng thì bảng này không nói
được gì về giá trị thật của hệ thống. Yêu cầu Level 2 được đánh dấu `(L2)`.

## Cách đọc cột "Mức đáp ứng"

| Giá trị       | Nghĩa                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Đạt           | Đã có code và có test chứng minh                                          |
| Một phần      | Đã thiết kế và có một phần code, nhưng chưa đủ để coi là xong             |
| Chưa đạt      | Chưa có code. Ghi rõ ra thay vì bỏ trống                                  |
| Không áp dụng | Hệ thống không có thành phần mà yêu cầu nói tới                           |
| Vượt yêu cầu  | Mô hình E2EE đảm bảo mạnh hơn mức yêu cầu đòi hỏi, kèm giải thích tại sao |

**Tình trạng chung tại thời điểm rà soát:** `server/` mới có `POST /api/register` và `GET /api/health`;
`web/` còn là khung trống. Vì vậy nhiều yêu cầu thuộc V3, V6, V7, V8 đang ở mức "Chưa đạt" hoặc "Một
phần" — không phải do thiết kế sai mà do chưa viết tới. Các ô đó ghi rõ thiết kế đã chốt ở đâu.

---

## V1 Encoding and Sanitization

| Mã yêu cầu | Nội dung tóm tắt                          | Mức đáp ứng   | Thực hiện ở đâu (file, test)                                                             | Ghi chú                                                                                                                  |
| ---------- | ----------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1.2.1      | Mã hóa đầu ra đúng ngữ cảnh HTML/HTTP     | Một phần      | `web/` (chưa viết); React tự escape nội dung chèn vào JSX                                | Quy tắc cấm `dangerouslySetInnerHTML` ghi trong `CLAUDE.md`; chưa có giao diện để kiểm chứng                             |
| 1.2.2      | Mã hóa dữ liệu không tin cậy khi dựng URL | Đạt           | `client-sdk/src/fetchTransport.js` — `encodeURIComponent` cho mọi tham số đường dẫn      | Không có nơi nào dựng URL từ dữ liệu server trả về                                                                       |
| 1.2.3      | Tránh JSON/JavaScript injection           | Đạt           | `client-sdk/src/fetchTransport.js` dùng `JSON.stringify`; server dùng parser của Fastify | Không tự nối chuỗi JSON ở bất kỳ đâu                                                                                     |
| 1.2.4      | Truy vấn CSDL tham số hóa                 | Đạt           | `server/src/routes/auth.js` qua Prisma; `server/prisma/schema.prisma`                    | Prisma sinh truy vấn tham số hóa; repo không có SQL viết tay                                                             |
| 1.2.5      | Chống OS command injection                | Không áp dụng | —                                                                                        | Ứng dụng không gọi lệnh hệ điều hành                                                                                     |
| 1.3.1      | Làm sạch HTML từ WYSIWYG                  | Không áp dụng | —                                                                                        | Note là văn bản thuần, không có trình soạn thảo HTML. Server cũng không đọc được nội dung để làm sạch                    |
| 1.3.2      | Tránh `eval()` và thực thi mã động        | Đạt           | `eslint.config.js` (`no-eval`, `no-new-func`, `no-implied-eval`); D06                    | Đây là lý do client kiểm tra schema bằng `Value.Check` chứ không dùng ajv: ajv sinh hàm bằng `new Function`, bị CSP chặn |
| 1.5.1      | Cấu hình parser XML an toàn               | Không áp dụng | —                                                                                        | Toàn hệ thống chỉ dùng JSON                                                                                              |

## V2 Validation and Business Logic

| Mã yêu cầu | Nội dung tóm tắt                             | Mức đáp ứng | Thực hiện ở đâu (file, test)                                                         | Ghi chú                                                                                                          |
| ---------- | -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 2.1.1      | Tài liệu định nghĩa quy tắc kiểm tra đầu vào | Đạt         | `docs/API.md`; `shared/src/schemas.js`                                               | Schema TypeBox vừa là tài liệu vừa là code kiểm tra — không thể lệch nhau                                        |
| 2.2.1      | Kiểm tra đầu vào theo allow-list             | Đạt         | `shared/src/schemas.js`; test `shared/test/shared.test.js`                           | Dùng pattern và độ dài chính xác theo số byte, không dùng deny-list                                              |
| 2.2.2      | Kiểm tra ở tầng dịch vụ tin cậy              | Một phần    | `server/src/app.js` (ajv, `removeAdditional: false`); `server/test/register.test.js` | Đã đúng cho route đã có; các route còn lại chưa viết. Kiểm tra ở client là để báo lỗi sớm, không phải lớp bảo vệ |
| 2.3.1      | Luồng nghiệp vụ theo đúng thứ tự bước        | Một phần    | D18 (version tăng đúng 1); `shared/src/schemas.js` `NoteUpdateRequest`               | Quy tắc đã có trong schema; server chưa có route `PUT /api/notes/:id` để thi hành                                |

## V3 Web Frontend Security

| Mã yêu cầu | Nội dung tóm tắt                                     | Mức đáp ứng   | Thực hiện ở đâu (file, test)                                                                         | Ghi chú                                                                                                                                     |
| ---------- | ---------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.2.1      | Chặn trình duyệt diễn giải nội dung sai ngữ cảnh     | Đạt           | `deploy/Caddyfile` (`X-Content-Type-Options: nosniff`); `server/src/plugins/security.js` (helmet)    | CSP của API đặt `default-src 'none'`                                                                                                        |
| 3.2.2      | Hiển thị văn bản bằng hàm render an toàn             | Chưa đạt      | `web/` chưa viết                                                                                     | Quy tắc đã chốt: nội dung note hiển thị dạng văn bản thuần, cấm `dangerouslySetInnerHTML`                                                   |
| 3.3.1      | Cookie có `Secure` và tiền tố `__Host-`/`__Secure-`  | **Chưa đạt**  | `shared/src/config.js` — `SESSION.COOKIE_NAME = 'sid'`                                               | **Việc cần làm:** đổi thành `__Host-sid`. Tên hiện tại không có tiền tố nào, trong khi thiết kế đã cùng origin nên `__Host-` dùng được ngay |
| 3.4.1      | HSTS trên mọi phản hồi, `max-age` ≥ 1 năm            | Một phần      | `server/src/plugins/security.js` (helmet, bật khi production); `deploy/Caddyfile`                    | Dòng HSTS trong Caddyfile đang bị comment, chờ có HTTPS thật. Phải bật trước khi nộp/demo công khai                                         |
| 3.4.2      | CORS `Access-Control-Allow-Origin` cố định           | Không áp dụng | `web/vite.config.js` (proxy), `deploy/Caddyfile`                                                     | Giao diện và API cùng origin (D07) nên không bật CORS. Không có CORS là trạng thái an toàn nhất ở đây                                       |
| 3.5.1      | Chống CSRF cho chức năng nhạy cảm                    | Đạt           | `server/src/plugins/security.js` — chặn Origin lạ với mọi method ghi; test `server/test/app.test.js` | Kết hợp cookie `SameSite=Strict`                                                                                                            |
| 3.5.2      | Không gọi được chức năng nhạy cảm mà không preflight | Đạt           | `server/src/plugins/security.js`                                                                     | Kiểm tra Origin áp dụng cho mọi method không nằm trong GET/HEAD/OPTIONS                                                                     |
| 3.5.3      | Chức năng nhạy cảm dùng POST/PUT/DELETE              | Đạt           | `docs/API.md`                                                                                        | Không có thao tác thay đổi dữ liệu nào đi bằng GET                                                                                          |

## V4 API and Web Service

| Mã yêu cầu | Nội dung tóm tắt                         | Mức đáp ứng   | Thực hiện ở đâu (file, test) | Ghi chú                                                                                      |
| ---------- | ---------------------------------------- | ------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| 4.1.1      | `Content-Type` khớp nội dung, có charset | Một phần      | Mặc định của Fastify         | Fastify trả `application/json` nhưng không kèm `charset=utf-8`. Cần kiểm tra lại khi rà soát |
| 4.4.1      | WebSocket qua TLS                        | Không áp dụng | —                            | Hệ thống không dùng WebSocket                                                                |

## V5 File Handling

Không áp dụng toàn bộ chương: ứng dụng không nhận, lưu hay phục vụ file do người dùng tải lên. Note
chỉ là văn bản, và server chỉ thấy ciphertext.

## V6 Authentication

| Mã yêu cầu | Nội dung tóm tắt                                       | Mức đáp ứng   | Thực hiện ở đâu (file, test)                                                               | Ghi chú                                                                                                                                                          |
| ---------- | ------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1.1      | Tài liệu mô tả rate limit, chống tự động hóa           | Một phần      | `shared/src/config.js` (`RATE_LIMITS`); `docs/API.md`                                      | Mới định nghĩa cho `/register`. Cần bổ sung cho `/login` và `/users/:email/salt`                                                                                 |
| —          | Chống dò email khi tra salt (D15)                      | Một phần      | `server/src/lib/fake-salt.js`; test `server/test/lib.test.js`                              | Không phải yêu cầu ASVS, ghi ở đây cho đủ bức tranh V6: hàm sinh salt giả đã xong và có test, nhưng chưa route nào gọi nó                                        |
| 6.2.1      | Mật khẩu tối thiểu 8 ký tự                             | **Chưa đạt**  | —                                                                                          | **Việc cần làm:** hiện KHÔNG có chỗ nào kiểm tra độ dài mật khẩu. Server không thấy mật khẩu nên phải kiểm tra ở client; thêm hằng số vào `shared/src/config.js` |
| 6.2.2      | Người dùng đổi được mật khẩu                           | Một phần      | `client-sdk/src/client.js` `changePassword()`; test `client-sdk/test/client.test.js`       | SDK và schema đã xong; server chưa có route `POST /api/change-password`                                                                                          |
| 6.2.3      | Đổi mật khẩu phải nhập cả mật khẩu cũ và mới           | Đạt           | `client-sdk/src/client.js` gửi `oldAuthKey` (D25); test "đổi mật khẩu với mật khẩu cũ sai" | Không chỉ dựa vào cookie: người mượn được máy đang đăng nhập vẫn không đổi được                                                                                  |
| 6.2.4      | Đối chiếu danh sách mật khẩu phổ biến (top 3000)       | **Chưa đạt**  | —                                                                                          | Phải làm ở client vì server không thấy mật khẩu. Cân nhắc dùng danh sách rút gọn để không phình bundle                                                           |
| 6.2.5      | Chấp nhận mọi tổ hợp ký tự                             | Đạt           | `client-sdk/src/client.js`                                                                 | Không có quy tắc bắt buộc chữ hoa/ký tự đặc biệt                                                                                                                 |
| 6.2.6      | Ô nhập mật khẩu dùng `type=password`                   | Chưa đạt      | `web/` chưa viết                                                                           | —                                                                                                                                                                |
| 6.2.7      | Cho phép dán và dùng trình quản lý mật khẩu            | Chưa đạt      | `web/` chưa viết                                                                           | Không được chặn sự kiện paste                                                                                                                                    |
| 6.2.8      | Xác minh mật khẩu đúng như người dùng nhập             | Đạt           | `client-sdk/src/client.js`; `crypto/src/kdf.js`                                            | Chỉ email được chuẩn hóa (D10); mật khẩu đưa thẳng vào Argon2id, không trim, không đổi hoa thường                                                                |
| 6.3.1      | Có kiểm soát chống credential stuffing/brute force     | Một phần      | `server/src/routes/auth.js` (`RATE_LIMITS.REGISTER`); test `server/test/register.test.js`  | `/register` đã có. `/login` chưa tồn tại nên chưa có gì chặn dò mật khẩu — đây là khoảng trống lớn nhất của chương này                                           |
| 6.3.2      | Không có tài khoản mặc định                            | Đạt           | `server/prisma/`                                                                           | Không có migration hay seed nào tạo tài khoản sẵn                                                                                                                |
| 6.4.1      | Mật khẩu/mã kích hoạt khởi tạo sinh ngẫu nhiên an toàn | Không áp dụng | —                                                                                          | Người dùng tự đặt mật khẩu khi đăng ký, hệ thống không phát mật khẩu ban đầu                                                                                     |
| 6.4.2      | Không dùng câu hỏi bí mật / gợi ý mật khẩu             | Đạt           | `server/prisma/schema.prisma`                                                              | Không có trường nào cho câu hỏi bí mật. D27 (recovery key) nếu làm sẽ dùng khóa ngẫu nhiên, không dùng câu hỏi                                                   |

**Ghi chú chung cho V6:** ở mô hình này server không bao giờ nhận mật khẩu. Thứ nó nhận là `authKey`
— khóa 32 byte dẫn xuất từ Argon2id rồi tách bằng `crypto_kdf` (D12). Nhiều yêu cầu V6 giả định
server nắm mật khẩu; xem thêm 11.4.2 bên dưới.

## V7 Session Management

| Mã yêu cầu | Nội dung tóm tắt                            | Mức đáp ứng | Thực hiện ở đâu (file, test)                    | Ghi chú                                                                                          |
| ---------- | ------------------------------------------- | ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 7.2.1      | Xác minh session ở backend tin cậy          | Chưa đạt    | `server/prisma/schema.prisma` (model `Session`) | Thiết kế đã có, code chưa có. Đây là việc chặn đường toàn bộ V7 và V8                            |
| 7.2.2      | Token phiên sinh động, không dùng khóa tĩnh | Chưa đạt    | model `Session`                                 | Thiết kế: token ngẫu nhiên mỗi phiên                                                             |
| 7.2.3      | Token tham chiếu ≥ 128 bit từ CSPRNG        | Chưa đạt    | model `Session` (`id` = SHA-256 của token)      | Thiết kế đã chốt: cookie giữ token gốc, DB chỉ lưu bản băm — lộ DB không dựng lại được phiên     |
| 7.2.4      | Sinh token mới khi đăng nhập, hủy token cũ  | Chưa đạt    | D36 (chỉ `POST /api/login` tạo phiên)           | Thiết kế gom việc tạo phiên về một chỗ duy nhất để dễ kiểm soát                                  |
| 7.4.1      | Đăng xuất/hết hạn thì vô hiệu hóa phiên     | Một phần    | `client-sdk/src/client.js` `logout()` (D26)     | Client đã xóa khóa bằng `sodium.memzero`; server chưa có `POST /api/logout` để xóa bản ghi phiên |
| 7.4.2      | Hủy mọi phiên khi tài khoản bị vô hiệu/xóa  | Chưa đạt    | `onDelete: Cascade` trong `schema.prisma`       | Xóa user sẽ xóa phiên theo ràng buộc khóa ngoại; chưa có chức năng vô hiệu hóa tài khoản         |

## V8 Authorization

| Mã yêu cầu | Nội dung tóm tắt                                 | Mức đáp ứng | Thực hiện ở đâu (file, test)                                                           | Ghi chú                                                                                                                                       |
| ---------- | ------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1.1      | Tài liệu định nghĩa quy tắc phân quyền           | Đạt         | `docs/API.md` (cột "Cần đăng nhập", ghi chú từng route); D16, D22, D30                 | —                                                                                                                                             |
| 8.2.1      | Giới hạn truy cập theo chức năng                 | Chưa đạt    | —                                                                                      | Chưa có route nào cần đăng nhập được viết ở server                                                                                            |
| 8.2.2      | Giới hạn truy cập theo từng bản ghi (chống IDOR) | Một phần    | `client-sdk/src/memoryTransport.js`; test "Bob KHÔNG đọc được note không được chia sẻ" | Quy tắc D30 đã được thi hành và có test — **nhưng mới ở server giả**. Server thật chưa có. Xem 8.3.1                                          |
| 8.3.1      | Thi hành phân quyền ở tầng dịch vụ tin cậy       | Chưa đạt    | —                                                                                      | `memoryTransport` KHÔNG phải tầng tin cậy, nó chạy trong trình duyệt. Test hiện có chứng minh thiết kế đúng, chưa chứng minh hệ thống an toàn |

## V9 Self-contained Tokens

Không áp dụng: hệ thống dùng token tham chiếu (bản ghi `Session` trong CSDL), không dùng JWT hay bất
kỳ token tự chứa nào. Đây là lựa chọn có chủ đích — token tham chiếu thu hồi được ngay, còn JWT thì
không.

## V10 OAuth and OIDC

Không áp dụng: không có đăng nhập bằng bên thứ ba. Ở mô hình E2EE, đăng nhập qua OAuth sẽ không dẫn
xuất được masterKey từ mật khẩu, nên đây cũng là lựa chọn bắt buộc chứ không chỉ là cắt giảm phạm vi.

## V11 Cryptography

| Mã yêu cầu  | Nội dung tóm tắt                                         | Mức đáp ứng      | Thực hiện ở đâu (file, test)                                                                                                | Ghi chú                                                                                                                                                                                                                         |
| ----------- | -------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11.1.1 (L2) | Có chính sách quản lý vòng đời khóa                      | Một phần         | `docs/THREAT_MODEL.md` mục 6; D12, D13, D24, D25                                                                            | Vòng đời khóa đã mô tả (sinh, bọc, xoay khi thu hồi, bọc lại khi đổi mật khẩu). Chưa đối chiếu với NIST SP 800-57                                                                                                               |
| 11.1.2 (L2) | Có bảng kê khóa, thuật toán, chứng chỉ                   | Đạt              | `docs/THREAT_MODEL.md` mục 6 (bảng kê khóa)                                                                                 | —                                                                                                                                                                                                                               |
| 11.2.1 (L2) | Dùng thư viện mật mã đã được kiểm chứng                  | Đạt              | `crypto/package.json` — `libsodium-wrappers-sumo`; D32                                                                      | Không tự cài đặt nguyên thủy mật mã nào                                                                                                                                                                                         |
| 11.2.2 (L2) | Thiết kế cho phép thay/nâng cấp thuật toán               | Một phần         | D13 (`kdfParams` lưu theo từng user); `shared/src/schemas.js` `KdfParams`                                                   | Tham số Argon2id nâng được mà không hỏng tài khoản cũ. **Nhưng** ciphertext chưa có trường đánh dấu phiên bản thuật toán, nên đổi AEAD sẽ khó                                                                                   |
| 11.2.3 (L2) | Mọi nguyên thủy đạt tối thiểu 128 bit an toàn            | Đạt              | `crypto/src/` — XChaCha20-Poly1305 (khóa 256 bit), X25519, Ed25519 (~128 bit)                                               | —                                                                                                                                                                                                                               |
| 11.3.1      | Không dùng chế độ khối yếu (ECB) hay padding yếu         | Đạt              | `crypto/src/note.js`, `vault.js`, `sharing.js`                                                                              | XChaCha20 là stream cipher, không có chế độ khối và không cần padding                                                                                                                                                           |
| 11.3.2      | Chỉ dùng cipher và mode được chấp thuận                  | Đạt              | `crypto/src/` — XChaCha20-Poly1305 IETF                                                                                     | ASVS nêu ví dụ AES-GCM. XChaCha20-Poly1305 là AEAD tương đương, nonce 24 byte nên random mỗi lần là an toàn, không phải quản lý bộ đếm nonce như AES-GCM 96 bit                                                                 |
| 11.3.3 (L2) | Dữ liệu mã hóa được bảo vệ chống sửa đổi                 | Đạt              | Toàn bộ `crypto/src/`; test `crypto/test/note.test.js`, `vault.test.js`                                                     | Mọi thao tác đều là AEAD: sửa một byte ciphertext là Poly1305 tag sai và hàm giải mã ném lỗi                                                                                                                                    |
| 11.4.1      | Chỉ dùng hàm băm được chấp thuận                         | Đạt              | `crypto/src/kdf.js` (BLAKE2b qua `crypto_kdf`), `sharing.js` (`crypto_generichash`), `server/src/lib/auth-key.js` (SHA-256) | BLAKE2b và SHA-256 đều là hàm băm được chấp thuận                                                                                                                                                                               |
| 11.4.2 (L2) | Mật khẩu lưu bằng hàm băm chậm, tham số theo khuyến nghị | **Vượt yêu cầu** | `crypto/src/kdf.js`; `server/src/lib/auth-key.js`; D14                                                                      | Server **không bao giờ nhận mật khẩu**. Argon2id chạy ở trình duyệt; thứ gửi lên là `authKey` 32 byte. Server lưu SHA-256(`authKey`) — băm nhanh là đủ vì `authKey` đã có entropy đầy đủ, không phải thứ đoán được bằng từ điển |
| 11.4.3 (L2) | Hàm băm dùng trong chữ ký chống va chạm, đủ độ dài       | Đạt              | `crypto/src/sharing.js` — Ed25519 (SHA-512 bên trong)                                                                       | —                                                                                                                                                                                                                               |
| 11.4.4 (L2) | Dùng KDF có key stretching khi dẫn xuất khóa từ mật khẩu | Đạt              | `crypto/src/kdf.js` — Argon2id, `opslimit=3`, `memlimit=64MB`; `crypto/benchmark/argon2-benchmark.js`                       | Tham số gom trong `shared/src/config.js` (`KDF_DEFAULTS`). Số đo trên máy phát triển: 64 MB ≈ 330 ms, 128 MB ≈ 627 ms                                                                                                           |
| 11.5.1 (L2) | Giá trị ngẫu nhiên từ CSPRNG, ≥ 128 bit entropy          | Đạt              | `crypto/src/kdf.js` `generateSalt()`, `vault.js` `generateVaultKey()`; `client-sdk/src/client.js` (`crypto.randomUUID`)     | Toàn bộ dùng `randombytes_buf` của libsodium. Salt 128 bit, mọi khóa 256 bit                                                                                                                                                    |
| 11.6.1 (L2) | Thuật toán được chấp thuận cho sinh khóa và chữ ký       | Đạt              | `crypto/src/sharing.js` — X25519 cho ECDH, Ed25519 cho chữ ký; test `crypto/test/sharing.test.js`                           | Hai cặp khóa **tách biệt**: dùng chung một cặp cho cả mã hóa và ký là anti-pattern                                                                                                                                              |

## V12 Secure Communication

| Mã yêu cầu | Nội dung tóm tắt                          | Mức đáp ứng | Thực hiện ở đâu (file, test) | Ghi chú                                                                                      |
| ---------- | ----------------------------------------- | ----------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| 12.1.1     | Chỉ bật TLS 1.2 / 1.3                     | Một phần    | `deploy/Caddyfile`           | Caddy mặc định chỉ bật TLS 1.2+. Chưa kiểm chứng bằng lần deploy thật                        |
| 12.2.1     | Mọi kết nối ra ngoài đều qua TLS          | Một phần    | `deploy/Caddyfile`           | Caddy tự cấp HTTPS khi có tên miền thật; cấu hình hiện tại vẫn là `:8080` cho môi trường thử |
| 12.2.2     | Dùng chứng chỉ TLS được tin cậy công khai | Một phần    | `deploy/Caddyfile`           | Sẽ do Let's Encrypt cấp qua Caddy khi thay `:8080` bằng tên miền                             |

**Lưu ý:** TLS bảo vệ đường truyền, không bảo vệ khỏi chính server. Giá trị của hệ thống này nằm ở
chỗ kể cả khi TLS bị gỡ và server bị chiếm, nội dung note vẫn là ciphertext.

## V13 Configuration

| Mã yêu cầu | Nội dung tóm tắt                           | Mức đáp ứng | Thực hiện ở đâu (file, test)              | Ghi chú                                                                                      |
| ---------- | ------------------------------------------ | ----------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| 13.4.1     | Không deploy kèm metadata quản lý mã nguồn | Một phần    | `deploy/docker-compose.yml`, `.gitignore` | Caddy chỉ phục vụ `web/dist`, không phục vụ thư mục repo. Cần kiểm chứng lại khi deploy thật |

**Ngoài phạm vi L1 nhưng đã làm:** `server/src/config.js` bắt buộc đặt `SERVER_SECRET` khi chạy
production và từ chối khởi động nếu còn để giá trị mẫu; `.env` nằm trong `.gitignore`.

## V14 Data Protection

| Mã yêu cầu  | Nội dung tóm tắt                                              | Mức đáp ứng  | Thực hiện ở đâu (file, test)                                                          | Ghi chú                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14.1.1 (L2) | Phân loại dữ liệu nhạy cảm theo mức bảo vệ                    | Đạt          | `docs/THREAT_MODEL.md` mục 1                                                          | —                                                                                                                                                                                        |
| 14.1.2 (L2) | Mỗi mức bảo vệ có yêu cầu cụ thể kèm theo                     | Đạt          | `docs/THREAT_MODEL.md` mục 1 và 6                                                     | —                                                                                                                                                                                        |
| 14.2.1      | Không đặt dữ liệu nhạy cảm trong URL/query string             | **Một phần** | `docs/API.md` — `GET /api/users/:email/salt`, `GET /api/users/:email/keys`            | Session token nằm trong cookie, không nằm trong URL. **Nhưng email nằm trên đường dẫn**, nên sẽ vào access log của Caddy. Cần cân nhắc chuyển sang POST hoặc không ghi log đường dẫn này |
| 14.2.2 (L2) | Không cache dữ liệu nhạy cảm ở thành phần trung gian          | Vượt yêu cầu | Toàn bộ `crypto/`                                                                     | Thứ đi qua proxy/cache chỉ là ciphertext. Dù có bị cache cũng không lộ nội dung                                                                                                          |
| 14.2.3 (L2) | Không gửi dữ liệu nhạy cảm cho bên thứ ba                     | Đạt          | `deploy/Caddyfile` (CSP `connect-src 'self'`); `web/package.json`                     | Không có tracker, không có CDN ngoài. CSP chặn mọi kết nối ra ngoài origin                                                                                                               |
| 14.2.4 (L2) | Thi hành đúng các kiểm soát đã ghi cho từng mức bảo vệ        | Đạt          | `docs/THREAT_MODEL.md` mục 6; `CLAUDE.md` (cấm log khóa/ciphertext)                   | —                                                                                                                                                                                        |
| 14.3.1      | Xóa dữ liệu đã xác thực khỏi bộ nhớ client khi kết thúc phiên | Đạt          | `client-sdk/src/client.js` `logout()`; test "logout() xóa khóa khỏi bộ nhớ (memzero)" | Không chỉ gán `null` rồi chờ GC: dùng `sodium.memzero` để ghi đè khóa ngay                                                                                                               |
| 14.3.2 (L2) | Đặt header chống cache cho dữ liệu nhạy cảm                   | Chưa đạt     | —                                                                                     | Chưa đặt `Cache-Control: no-store`. Rủi ro thấp vì phản hồi chỉ chứa ciphertext, nhưng vẫn nên thêm                                                                                      |
| 14.3.3 (L2) | Không lưu dữ liệu nhạy cảm trong browser storage              | Đạt          | `client-sdk/src/client.js` (khóa chỉ nằm trong thuộc tính instance); `CLAUDE.md`      | D20 sẽ dùng `localStorage` để nhớ version cao nhất của từng note — version không phải bí mật nên không vi phạm điều này                                                                  |

## V15 Secure Coding and Architecture

| Mã yêu cầu | Nội dung tóm tắt                                    | Mức đáp ứng | Thực hiện ở đâu (file, test)                                                  | Ghi chú                                                                                                     |
| ---------- | --------------------------------------------------- | ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 15.1.1     | Tài liệu định nghĩa thời hạn vá thư viện có lỗ hổng | Chưa đạt    | —                                                                             | CI đã chặn, nhưng chưa ghi thành mốc thời gian cam kết. Với đồ án học phần: vá trong vòng một tuần làm việc |
| 15.2.1     | Không chứa thành phần quá hạn vá                    | Đạt         | `.github/workflows/ci.yml` — `pnpm audit --audit-level high`; D33             | D33 ép `deepmerge-ts >= 8` để vá GHSA-ggr8-5vv4-36mx trong phụ thuộc gián tiếp của Prisma                   |
| 15.3.1     | Chỉ trả về đúng tập trường cần thiết                | Đạt         | `server/src/routes/auth.js` (`select: { id: true }`); `shared/src/schemas.js` | `NoteListItem` cố tình không có `encryptedContent`; test `shared/test/shared.test.js` kiểm tra điều này     |

**Ngoài phạm vi L1 nhưng là điểm mạnh của kiến trúc:** ranh giới giữa các package được **kiểm tra tự
động** bằng `.dependency-cruiser.cjs` trong CI — `server/` không thể import `crypto/`, `client-sdk/`
hay libsodium. Đây là bằng chứng máy kiểm được cho giả định "máy chủ không tin cậy", không chỉ là
lời hứa trong tài liệu.

## V16 Security Logging and Error Handling

Chương này **không có yêu cầu Level 1** nào. Các mục Level 2 liên quan trực tiếp tới thiết kế:

| Mã yêu cầu  | Nội dung tóm tắt                                     | Mức đáp ứng | Thực hiện ở đâu (file, test)                                            | Ghi chú                                                                                                         |
| ----------- | ---------------------------------------------------- | ----------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 16.2.5 (L2) | Ghi log dữ liệu nhạy cảm theo đúng mức bảo vệ        | Đạt         | `CLAUDE.md`; `server/src/plugins/errors.js`                             | Quy tắc tuyệt đối: không log `authKey`, cookie, khóa hay ciphertext                                             |
| 16.3.1 (L2) | Ghi log mọi lần xác thực, cả thành công lẫn thất bại | Chưa đạt    | `server/prisma/schema.prisma` (model `LoginHistory`)                    | Bảng đã thiết kế (có cột `success`, `emailAttempted`), chưa có code ghi vào                                     |
| 16.3.2 (L2) | Ghi log các lần phân quyền thất bại                  | Chưa đạt    | —                                                                       | Chờ có route cần đăng nhập                                                                                      |
| 16.3.4 (L2) | Ghi log lỗi bất ngờ                                  | Đạt         | `server/src/plugins/errors.js` — `request.log.error(error)` cho lỗi 5xx | Chỉ log lỗi không lường trước; lỗi 4xx do người dùng gửi sai thì không                                          |
| 16.5.1 (L2) | Trả thông báo chung khi có lỗi nhạy cảm              | Đạt         | `server/src/plugins/errors.js`; test `server/test/app.test.js`          | Mọi lỗi ra ngoài đều là `{ code, message }` (D29), không kèm stack trace                                        |
| 16.5.3 (L2) | Thất bại an toàn, không fail-open                    | Đạt         | `server/src/plugins/errors.js`; `client-sdk/src/assertSchema.js`        | Lỗi không nhận diện được mặc định thành `INTERNAL_ERROR` 500. Client từ chối xử lý tiếp khi response sai schema |

## V17 WebRTC

Không áp dụng: hệ thống không dùng WebRTC.

---

## Ba khoảng trống cần xử lý trước khi nộp

1. **6.2.1 và 6.2.4 — không có bất kỳ ràng buộc nào về mật khẩu.** Đây là lỗ hổng thật, không phải
   việc chưa làm tới: toàn bộ sức mạnh của Argon2id sẽ vô nghĩa nếu người dùng đặt mật khẩu `123456`.
   Phải làm ở client vì server không thấy mật khẩu.
2. **3.3.1 — cookie phiên chưa có tiền tố `__Host-`.** Sửa một dòng trong `shared/src/config.js`, nên
   làm ngay trước khi viết route phiên.
3. **Toàn bộ V7 và V8 phụ thuộc vào việc server có route phiên.** Bảng này sẽ đổi nhiều nhất khi
   `server/` hoàn thành phần đó — nhớ rà lại.
