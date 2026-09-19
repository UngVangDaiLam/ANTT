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
