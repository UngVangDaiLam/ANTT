# Nhật ký quyết định thiết kế

Mỗi quyết định ghi: nội dung, lý do, người phụ trách. Thêm mới ở cuối, không xóa quyết định cũ;
nếu đổi ý thì ghi quyết định mới thay thế.

## Công nghệ

- **D01. Toàn bộ repo dùng JavaScript + ESM, không TypeScript.** Nhóm chưa quen TypeScript; kiểu
  dữ liệu tĩnh không chặn được Prototype Pollution, nên phòng thủ chính là kiểm tra schema lúc chạy.
- **D02. Monorepo pnpm:** `shared/`, `crypto/`, `client-sdk/`, `server/`, `web/`.
- **D03. Backend Fastify** thay vì Express: parser JSON mặc định từ chối `__proto__` và
  `constructor.prototype`. Chạy Node với `--disable-proto=throw` làm lớp phòng thủ thứ hai.
- **D04. PostgreSQL + Prisma 6.**
- **D05. Test bằng Vitest** cho toàn repo.
- **D06. Schema TypeBox trong `shared/`.** Server dùng làm JSON Schema; client kiểm tra response bằng
  `Value.Check`, không dùng ajv vì ajv sinh code bằng `new Function`, bị CSP chặn.
- **D07. Frontend React + Vite.** Giao diện và API chạy cùng origin (Vite proxy khi dev, Caddy khi deploy).
- **D08. Quy trình nhẹ:** ESLint + Prettier, PR nhỏ review chéo, commit `feat/fix/test`, hằng số gom về
  `shared/src/config.js`. Không áp dụng kiến trúc lớn kiểu Clean Architecture.
- **D09. Chuẩn đối chiếu bảo mật: OWASP ASVS 5.0.0** (17 chương).

## Mật mã và hợp đồng dữ liệu

- **D10. Định danh người dùng là email**, chuẩn hóa (trim + chữ thường) ở cả client và server.
- **D11. Nhị phân qua JSON dùng base64url không padding** (mặc định của libsodium).
- **D12. Tách khóa bằng `crypto_kdf` (BLAKE2b)** từ khóa gốc Argon2id thành authKey và masterKey.
- **D13. Server lưu `kdfParams` theo từng user** và trả kèm salt, để sau này tăng tham số Argon2id
  không làm hỏng tài khoản cũ.
- **D14. Server lưu SHA-256(authKey)**, so sánh bằng `timingSafeEqual`. authKey đã có entropy cao nên
  không cần băm chậm thêm.
- **D15. API lấy salt trả salt giả cố định cho email chưa đăng ký** (HMAC với bí mật của server), chống dò email.
- **D16. Server lấy danh tính từ session**, không nhận `email`, `ownerEmail`, `senderEmail` do client gửi.
- **D17. `noteId` do client sinh (UUID v4)** vì `noteId` nằm trong Associated Data. Server kiểm tra định
  dạng và từ chối id đã tồn tại.
- **D18. Version bắt đầu từ 1.** Server chỉ nhận ghi khi version mới = version hiện tại + 1, sai trả `VERSION_CONFLICT`.
- **D19. AD của nội dung note gồm noteId + version.**
- **D20. Chống rollback:** client nhớ version cao nhất đã thấy của từng note (localStorage, vì version không
  phải bí mật). Giới hạn: không bảo vệ được ở lần đọc đầu tiên trên thiết bị mới.
- **D21. Tiêu đề mã hóa riêng** (`encryptedTitle`, nonce riêng, cùng noteKey) để API danh sách không phải trả nội dung.
- **D22. Chia sẻ theo tham chiếu:** gói chia sẻ chỉ trỏ tới `noteId`, không sao chép ciphertext. Người nhận
  đọc qua `GET /api/notes/:id`, server cho phép nếu là chủ note hoặc có gói chia sẻ hợp lệ.
- **D23. Chữ ký Ed25519 của gói chia sẻ bao gồm noteId**; người nhận kiểm tra noteId khớp.
- **D24. Thu hồi quyền = xoay khóa note** qua `POST /api/notes/:id/rotate`, cập nhật trong một transaction.
  Giới hạn: không thu hồi được những gì người nhận đã đọc trước đó.
- **D25. Đổi mật khẩu trong một request**, gửi kèm authKey cũ; server hủy các phiên khác.
- **D26. Có `POST /api/logout`**; client xóa khóa bằng `sodium.memzero`.
- **D27. Recovery key làm sau nhóm A.** Chưa kịp trước mốc tuần 5 thì cắt, ghi là đánh đổi có chủ đích.

## Giới hạn và lỗi

- **D28. Server giới hạn request 1 MB; client chặn nội dung gốc tối đa 512 KB** trước khi mã hóa.
- **D29. Lỗi có dạng `{ code, message }`**, danh sách mã trong `shared/src/errors.js`.
- **D30. Truy cập note không thuộc về mình trả `NOT_FOUND`**, không trả `FORBIDDEN`, để không xác nhận note tồn tại.
- **D31. Trường lạ trong request bị từ chối**, không âm thầm xóa (tắt `removeAdditional` của Fastify).

## Thư viện

- **D32. Dùng `libsodium-wrappers-sumo` 0.8.x, không dùng 0.7.x.** Bản 0.7.16 bị lỗi khi import dạng ESM
  (bản build ESM tham chiếu tới file `libsodium-sumo.mjs` không tồn tại). Đã kiểm tra: 34 test cũ của Lâm
  vẫn pass với 0.8.4, và Vite build được cho trình duyệt.
- **D33. Ép `deepmerge-ts` >= 8 bằng `overrides`** để vá lỗ hổng GHSA-ggr8-5vv4-36mx trong phụ thuộc gián tiếp
  của Prisma. Prisma chỉ dùng hàm `deepmerge`, vẫn có trong bản 8.

## Tài khoản

- **D34. Quy ước đặt tên trường API** (Trần Bảo, cần Lâm xác nhận): camelCase, không hậu tố kiểu mã hóa
  (`salt` thay cho `saltB64`, vì mọi nhị phân đều là base64url theo D11); tên khóa ghi rõ thuật toán
  (`x25519PublicKey`, `ed25519PublicKey` thay cho `publicKey`, `signingPublicKey`); khóa đã bọc có tiền tố
  `wrapped` và tên đầy đủ (`wrappedX25519PrivateKey`). Tên cột Prisma trùng tên trường API.
  Áp dụng trước cho `POST /api/register`; `client-sdk` cần đổi theo.
- **D35. Đăng ký email đã tồn tại trả `409 EMAIL_TAKEN`.** Việc này để lộ email nào đã đăng ký, khác tinh thần
  D15, nhưng người dùng cần biết lý do đăng ký thất bại. Giảm thiểu bằng rate limit theo IP
  (`RATE_LIMITS.REGISTER`). Server dựa vào ràng buộc unique của DB (lỗi Prisma `P2002`), không kiểm tra trước,
  để tránh race condition.
- **D36. Đăng ký không tạo phiên**, trả `201` body rỗng; client đăng nhập ngay sau đó. Chỉ có một chỗ tạo phiên
  là `POST /api/login`, dễ kiểm soát và ghi lịch sử đăng nhập.

## client-sdk

- **D37. `client-sdk` dùng chung schema trong `shared/`, không có schema riêng.** Bản cũ tự định nghĩa
  một bộ schema song song với `additionalProperties: true` ở mọi object — vừa trái quy ước, vừa vô
  hiệu hóa chính lớp phòng thủ mà nó tự nhận là chống "server độc hại", vì trường lạ (kể cả
  `__proto__`) lọt qua hết. Hai bản schema cho cùng một API thì sớm muộn cũng lệch nhau: đó chính là
  nguyên nhân khiến SDK gửi `saltB64`/`publicKeyB64` trong khi server chờ `salt`/`x25519PublicKey`.
  Nay mọi response đều kiểm tra bằng đúng schema server dùng để kiểm tra request.
- **D38. Transport không nhận email cho thao tác cần đăng nhập.** D16 nói server lấy danh tính từ
  phiên; nếu hàm transport vẫn có tham số `ownerEmail`/`recipientEmail`/`senderEmail` thì client vẫn
  quen tay gửi lên và người đọc code tưởng server tin giá trị đó. Email chỉ còn ở ba chỗ nó thật sự
  là dữ liệu đầu vào: tra salt, tra khóa công khai của người khác, và chọn người nhận khi chia sẻ.
- **D39. `memoryTransport` kiểm tra hợp đồng chứ không chỉ giả lập kho dữ liệu.** Nó kiểm tra payload
  gửi lên và dữ liệu trả về bằng chính schema của `shared/`, lấy danh tính từ phiên của nó, và trả
  `NOT_FOUND` cho note không thuộc về người gọi. Nhờ vậy lệch tên trường hay quên đăng nhập là test
  đỏ ngay, không phải đợi nối vào server thật. Tách `createMemoryServer()` (kho dùng chung) khỏi
  `connect()` (một trình duyệt, một phiên) để test dựng được nhiều người dùng trên cùng một server.
- **D40. Mã lỗi mới `NOTE_ID_TAKEN` (409).** D17 yêu cầu server từ chối `noteId` đã tồn tại, nhưng
  chưa có mã lỗi cho việc đó; dùng `VERSION_CONFLICT` sẽ gây hiểu nhầm. Có lộ việc "id này đã tồn
  tại", nhưng UUID v4 không đoán được nên không dò được gì.
- **D41. `GET /api/notes` trả kèm `wrappedNoteKey` của từng note.** D21 mã hóa tiêu đề riêng để danh
  sách không phải tải nội dung, nhưng nếu không có khóa note đã bọc thì client không giải mã nổi
  tiêu đề và danh sách sẽ trống trơn. Khóa đó đã bọc bằng Vault Key của chính người gọi nên server
  không biết thêm gì.

## Quy ước mã hóa nhị phân

- **D42. Biến thể base64 ghi tường minh trong `crypto/src/base64.js`.** D11 chốt dùng base64url không
  padding, và đó cũng là mặc định của libsodium nên trước giờ code chỉ viết `to_base64(x)`. Rủi ro:
  schema trong `shared/` kiểm tra bằng pattern `^[A-Za-z0-9_-]+$` và độ dài chính xác theo số byte,
  nên chỉ cần một chỗ lỡ dùng `base64_variants.ORIGINAL` là server từ chối request mà không rõ vì
  sao. Nay `crypto/` và `client-sdk/` đều đi qua `toBase64`/`fromBase64`, biến quy ước ngầm thành
  quy ước tường minh ở đúng một chỗ.

## Phiên đăng nhập

- **D43. Phiên là token tham chiếu ngẫu nhiên 256 bit trong cookie `__Host-sid`; DB chỉ lưu SHA-256.**
  Cookie `httpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, không có `Domain`; tiền tố `__Host-` để
  subdomain khác không ghi đè được (ASVS 3.3.1). `Session.id` là SHA-256 dạng hex của token, nên lộ
  database không dựng lại được cookie. Dùng SHA-256 thường chứ không băm chậm vì token đã có 256 bit
  ngẫu nhiên, không đoán được. Phiên hết hạn **tuyệt đối** sau `SESSION.TTL_MS` (24 giờ) tính từ lúc
  đăng nhập, không tự gia hạn: đơn giản, và chặn trần thiệt hại nếu cookie bị lộ. `lastSeenAt` chỉ để
  hiển thị danh sách thiết bị, được cập nhật tối đa mỗi `SESSION.TOUCH_INTERVAL_MS` để không ghi DB
  ở mọi request.
- **D44. Mỗi lần đăng nhập cấp token mới và hủy token cũ mà client đang mang theo** (ASVS 7.2.4).
  Chỉ `POST /api/login` tạo phiên (D36), nên đây là chỗ duy nhất cần làm đúng.
- **D45. `/login` không phân biệt "email không tồn tại" với "sai mật khẩu".** Cùng mã `INVALID_CREDENTIALS`,
  cùng thông điệp, và luôn chạy phép so sánh hằng thời gian kể cả khi không có tài khoản. Lịch sử
  đăng nhập vẫn ghi cả hai trường hợp (`userId = null` khi email lạ). `GET /users/:email/salt` nay
  thật sự trả salt giả (D15). Giới hạn còn lại: rate limit mới theo IP, chưa theo từng tài khoản.
- **D46. `TRUST_PROXY` mặc định tắt.** Sau Caddy phải bật để `request.ip` lấy từ `X-Forwarded-For`, nếu
  không mọi request trông như đến từ IP của Caddy và rate limit gộp cả thế giới vào một hàng đợi.
  Nhưng bật khi KHÔNG có proxy thì client tự khai IP giả được, phá luôn rate limit, nên không bật mặc định.

## Note, chia sẻ và đổi mật khẩu

- **D47. Xác thực chạy ở `onRequest`, không phải `preHandler`.** Fastify parse và validate body TRƯỚC
  `preHandler`, nên nếu xác thực đặt ở đó thì người chưa đăng nhập vẫn bắt được server đọc tới 1 MB
  body và chạy validate, và nhận `400` thay vì `401`. Ở `onRequest`, request không có phiên bị chặn ngay
  từ đầu và luôn nhận `401`.
- **D48. `KdfParams` có sàn và trần, kiểm tra ở cả server lẫn client.** Sàn là mức tối thiểu OWASP khuyến
  nghị cho Argon2id (t = 2, m = 19 MiB), trần chặn tham số khổng lồ (t = 16, m = 1 GiB). Lý do chính là
  **server độc hại**: client dẫn xuất khóa bằng tham số do server trả trong `/salt`; nếu không có sàn,
  server trả `opslimit = 1, memlimit = 8 KB` rồi mang `authKey` nhận được đi dò mật khẩu offline gần như
  tức thì. Client kiểm tra response bằng đúng schema này nên từ chối tham số dưới sàn. Trần chặn server
  làm treo hoặc sập tab bằng tham số khổng lồ. **Giới hạn còn lại:** server vẫn trả được đúng mức sàn,
  yếu hơn `KDF_DEFAULTS`, mà client không phân biệt được với tài khoản cũ hợp lệ (D13) — đó là đánh đổi
  chấp nhận được, ghi ở `docs/THREAT_MODEL.md`.
- **D49. Kiểm tra hình dạng dữ liệu mã hóa chặt hơn.** `nonce` đúng 24 byte, `ciphertext` ít nhất một
  tag (16 byte), có trần độ dài theo từng loại (tiêu đề 1 KB, nội dung 512 KB, khóa bọc 128 byte), gói
  chia sẻ đúng độ dài từng thành phần (khóa 32, nonce 24, chữ ký 64 byte). Trước đây các trường này chỉ
  cần là chuỗi base64url bất kỳ nên một client (hoặc kẻ có phiên) nhét được 900 KB vào `wrappedVaultKey`.
  Tiêu đề trước đó không có giới hạn nào ở client; nay client cũng chặn (tính theo byte UTF-8).
- **D50. Chốt hợp đồng `POST /api/notes/:id/rotate`.** Body gồm `version` (= hiện tại + 1), tiêu đề và nội
  dung mã hóa lại, `wrappedNoteKey` mới, và `shares`: mảng `{ recipientEmail, sharePackage }` cho MỖI
  người còn quyền. Tập người nhận sau khi xoay **đúng bằng** `shares`: ai vắng mặt bị thu hồi. Chọn "danh
  sách đầy đủ" thay vì "danh sách người bị thu hồi" vì client buộc phải tạo gói chia sẻ mới cho người ở
  lại (khóa đã đổi), nên danh sách đầy đủ là thông tin client đằng nào cũng có, và không thể xảy ra
  chuyện quên thu hồi. Tối đa 50 người, không được lặp, không được có chính mình. Một transaction.
- **D51. Ghi note bằng một câu `UPDATE` có điều kiện, không "kiểm tra rồi ghi".** `PUT` và `rotate` dùng
  `update({ where: { id, ownerId, version } })`: chủ note và version được kiểm tra cùng lúc với việc ghi,
  nên hai thiết bị cùng sửa từ một version thì đúng một bên thắng, không có khe hở giữa "đọc version" và
  "ghi". Không ghi được (`P2025`) thì mới tra thêm để phân biệt `NOT_FOUND` với `VERSION_CONFLICT`.
- **D52. Đổi mật khẩu: giữ phiên hiện tại, hủy phiên khác, trong một transaction.** Câu `UPDATE` mang
  điều kiện `authKeyHash` khớp giá trị vừa kiểm tra, nên hai yêu cầu đổi đồng thời với cùng `oldAuthKey`
  chỉ một cái thắng. Sai `oldAuthKey` trả `401 INVALID_CREDENTIALS` dù đang đăng nhập (giao diện phải xem
  `code`, không coi mọi `401` là hết phiên). Rate limit 5 lần / 15 phút vì đây cũng là chỗ thử `oldAuthKey`.
  **Giới hạn:** token của phiên hiện tại không được cấp lại (ASVS 7.2.4 chỉ bắt buộc khi đăng nhập).
- **D53. Xóa gói chia sẻ không phải thu hồi mật mã.** `DELETE /api/shares/:id` chỉ chặn lần đọc sau qua
  API; người nhận đã giải mã trước đó vẫn giữ được khóa. Thu hồi thật sự phải xoay khóa note (`rotate`,
  D24). Ghi rõ trong API.md để giao diện không hứa quá mức với người dùng.
- **D54. Test route chạy trên hai backend: DB giả và PostgreSQL thật.** Bộ test note, chia sẻ và đổi mật
  khẩu chỉ gọi API và đọc response (không soi vào DB), nên chạy nguyên xi trên cả hai. DB giả luôn chạy
  (CI, phát triển); PostgreSQL thật chạy khi đặt `TEST_DATABASE_URL`. Lý do: test với DB giả sơ sài chỉ
  chứng minh route đúng với chính DB giả đó, không chứng minh câu truy vấn Prisma chạy đúng; và chỉ khi
  cả hai cho kết quả giống nhau thì mới tin được DB giả. Từ D59, CI chạy cả hai backend.
- **D55. Lỗi của Prisma chỉ được log tên lớp và mã lỗi, không log message hay stack.** Đã kiểm chứng trên
  Prisma 6.19: `PrismaClientValidationError` in NGUYÊN đối tượng tham số của câu truy vấn vào message
  (và cả stack), tức là ciphertext, khóa đã bọc, `authKeyHash`. Đặt `errorFormat: 'minimal'` KHÔNG che
  được phần này. Vì vậy `server/src/plugins/errors.js` lọc lỗi Prisma trước khi ghi; lỗi thường của code
  vẫn log đủ để gỡ lỗi. `meta` cũng bị bỏ vì với vài mã lỗi nó chứa giá trị cột.
- **D56. Xác thực không được biến cuộc đua thành lỗi 500.** Cập nhật `lastSeenAt` dùng `updateMany`: nếu
  phiên vừa bị xóa (đăng xuất ở tab khác) giữa lúc đọc và lúc ghi thì trả `401`, không phải `500`.
  Phía client, `logout()` coi `UNAUTHENTICATED` từ server là thành công (phiên đã không còn), nhưng vẫn
  báo lỗi mất mạng để giao diện cảnh báo phiên ở server có thể còn sống. Khóa cục bộ luôn bị xóa.

## Test tích hợp

- **D57. Package riêng `integration/` cho test client-sdk ↔ server.** Test đơn vị của mỗi bên đều dùng đồ
  giả ở phía bên kia (`memoryTransport` ở SDK, body viết tay ở server), nên không bên nào phát hiện được
  việc hai bên hiểu hợp đồng API khác nhau — chính là lỗi đã xảy ra với tên trường ở D34/D37. Ranh giới
  kiến trúc cấm `client-sdk/` và `server/` import nhau, nên test này không đặt được ở package nào đang có.
  `integration/` chỉ chứa test, là nơi DUY NHẤT được dùng cả hai, và có quy tắc depcruise cấm mọi package
  khác import ngược vào nó. Chạy SDK thật (Argon2id và mã hóa thật) với server thật trên cổng thật, trên
  cả DB giả lẫn PostgreSQL thật (dùng chung `TEST_DATABASE_URL` với server; `integration` khai báo phụ
  thuộc vào `server` để `pnpm -r` chạy tuần tự, không tranh nhau database). Đã kiểm chứng giá trị: cố ý
  phá 6 chỗ ở ranh giới, 4 chỗ chỉ bộ này bắt được.
- **D58. `createFetchTransport(baseUrl, { fetch })` nhận hàm fetch từ ngoài.** Chỉ để test tích hợp chạy
  được trên Node với cookie jar riêng cho từng "trình duyệt". Giao diện không cần truyền: mặc định là
  fetch của trình duyệt. Gọi dạng hàm trần để tránh lỗi "Illegal invocation" trên trình duyệt.
- **D59. CI chạy test trên PostgreSQL thật.** Workflow có service `postgres:17`, đặt `TEST_DATABASE_URL`,
  sinh Prisma client rồi `prisma migrate deploy` trước `pnpm test`. Bước sinh client là bắt buộc: trong
  monorepo, `pnpm install` không tự tìm thấy `server/prisma/schema.prisma` (đã kiểm chứng: thiếu bước này
  thì test Postgres lỗi `Cannot find module '.prisma/client/default'`). Việc chạy `migrate deploy` trên
  database trống ở mỗi lần CI cũng là phép thử miễn phí rằng migration áp được từ đầu. Workflow đã được
  mô phỏng từng bước trên một bản sao sạch của repo trước khi đẩy lên.

## Sửa, xóa và thu hồi quyền ở client

- **D60. Thêm `GET /api/notes/:id/shares` (chỉ chủ note).** Hợp đồng cũ thiếu cách để chủ note biết note
  đang được chia sẻ cho ai: `GET /api/shares` chỉ trả các gói người khác gửi CHO MÌNH. Không có nó thì
  không lấy được `shareId` để gỡ chia sẻ, và không biết danh sách người còn quyền để xoay khóa (D50).
  Không trả gói chia sẻ (chủ note không cần). Người được chia sẻ nhận `404` (D30).
- **D61. `updateNote` bắt buộc truyền `version` của bản người dùng ĐANG SỬA.** Nếu SDK tự đọc version mới
  nhất rồi +1, hai thiết bị cùng sửa một note sẽ âm thầm ghi đè lên nhau và D18 trở nên vô dụng. SDK
  kiểm tra version trước khi mã hóa để khỏi gửi đi vô ích; server vẫn là nơi quyết định cuối cùng.
- **D62. `revokeAccess(noteId, emails)` là thu hồi MẬT MÃ, `unshareNote(shareId)` thì không.**
  `revokeAccess` giải mã nội dung, sinh khóa note mới, mã hóa lại, tạo gói chia sẻ mới cho từng người
  còn quyền rồi gọi `rotate` — khóa cũ mà người bị thu hồi có thể đã giữ không mở được nội dung mới (có
  test kiểm chứng trực tiếp bằng khóa cũ). `unshareNote` chỉ xóa gói chia sẻ ở server (D53). Email
  không nằm trong danh sách chia sẻ thì báo lỗi TRƯỚC khi xoay khóa, vì nhiều khả năng là gõ nhầm và
  người dùng sẽ tưởng đã thu hồi được quyền của ai đó. Danh sách rỗng nghĩa là chỉ xoay khóa, giữ nguyên
  mọi người. **Giới hạn:** danh sách người nhận được đọc ngay trước khi xoay; nếu đúng lúc đó một thiết
  bị khác của chính chủ note vừa chia sẻ cho người mới, người đó cũng bị gỡ.
