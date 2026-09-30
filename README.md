# Secure Notes

Ứng dụng web ghi chú mã hóa đầu cuối dựa trên mật mã lai X25519 – XChaCha20-Poly1305.

Giả định xuyên suốt: **máy chủ không tin cậy**. Mọi mã hóa và giải mã diễn ra ở trình duyệt;
server chỉ là kho lưu trữ mù.

## Cấu trúc

| Thư mục        | Người phụ trách | Vai trò                                                         |
| -------------- | --------------- | --------------------------------------------------------------- |
| `shared/`      | Lâm + Trần Bảo  | Schema API (TypeBox), hằng số cấu hình, mã lỗi. Không có mật mã |
| `crypto/`      | Lâm             | Module mật mã thuần, không gọi mạng                             |
| `client-sdk/`  | Lâm             | Cầu nối: gọi `crypto/` và API, trả kết quả đơn giản cho web     |
| `server/`      | Trần Bảo        | Fastify + PostgreSQL, kho lưu trữ mù                            |
| `web/`         | Phan Bảo        | React + Vite, chỉ gọi `client-sdk/`                             |
| `docs/`        | Cả nhóm         | API, quyết định thiết kế, threat model, bảng ASVS               |
| `deploy/`      | Trần Bảo        | Docker Compose, Caddy                                           |
| `integration/` | Cả nhóm         | Chỉ chứa test: client-sdk thật gọi server thật qua HTTP         |

## Ranh giới bắt buộc

Kiểm tra tự động bằng `pnpm depcheck` (dependency-cruiser), CI sẽ báo lỗi nếu vi phạm:

- `server/` không import `crypto/`, `client-sdk/` hay libsodium.
- `web/` chỉ import `client-sdk/`.
- `crypto/` không biết gì về mạng, server hay giao diện.
- `shared/` không phụ thuộc gói nào khác của dự án.
- `integration/` là nơi duy nhất được dùng cả `client-sdk/` lẫn `server/`; không ai import ngược vào nó.

## Bắt đầu

Yêu cầu: Node.js 24 LTS (tối thiểu 22.13), pnpm 10, Docker (để chạy PostgreSQL).

Muốn xem bản chạy đầy đủ (HTTPS, giống lúc nộp bài) mà không cần cài Node: mục _Triển khai (HTTPS)_ bên dưới
chỉ cần Docker.

```bash
corepack enable            # bật pnpm đúng phiên bản ghi trong package.json
pnpm install
pnpm --filter @secure-notes/server db:generate   # sinh Prisma client (bắt buộc trước khi chạy server)
pnpm check                 # lint + format + ranh giới kiến trúc + test

# Chạy server
docker compose -f deploy/docker-compose.yml up -d        # PostgreSQL cho máy dev
cp server/.env.example server/.env                       # Windows PowerShell: Copy-Item
pnpm --filter @secure-notes/server exec prisma migrate deploy   # tạo bảng trong database
pnpm dev:server            # http://127.0.0.1:3000/api/health

# Chạy giao diện (cửa sổ khác)
pnpm dev:web               # http://localhost:5173, /api tự chuyển về server
```

## Chạy test với PostgreSQL thật

Mặc định `pnpm test` chạy test route trên DB giả trong bộ nhớ. Để chạy thêm trên PostgreSQL thật
(kiểm chứng câu truy vấn Prisma, transaction và ràng buộc của DB), tạo một database **riêng** cho test:

```bash
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml exec db psql -U securenotes -d postgres -c "CREATE DATABASE securenotes_test"

# Linux/macOS/Git Bash
export TEST_DATABASE_URL=postgresql://securenotes:securenotes@localhost:5433/securenotes_test
# PowerShell:  $env:TEST_DATABASE_URL = "postgresql://securenotes:securenotes@localhost:5433/securenotes_test"

cd server
DATABASE_URL=$TEST_DATABASE_URL pnpm exec prisma migrate deploy
pnpm test
```

Biến này áp dụng cho cả `server/` lẫn `integration/`: `pnpm test` ở thư mục gốc chạy cả hai trên
PostgreSQL thật.

**Cảnh báo:** các bảng trong database đó bị xóa sạch trước mỗi test. Không bao giờ trỏ vào database dev
đang có dữ liệu. Chi tiết ở `server/test/helpers/backends.js` và D54.

## Kiểm tra giao diện bằng Chrome thật

Đi hết các luồng chính (đăng ký, ghi chú, chia sẻ, thu hồi, xung đột, thiết bị, khổ điện thoại...) bằng
Chrome headless, chụp ảnh từng bước vào `web/e2e/shots/`. Cần Chrome đã cài; không cần thư viện thêm.

```bash
pnpm dev:server             # cửa sổ 1 (cần PostgreSQL đang chạy)
pnpm dev:web                # cửa sổ 2
pnpm --filter @secure-notes/web ui-check

# Hoặc với bản triển khai HTTPS:
BASE=https://localhost/ pnpm --filter @secure-notes/web ui-check
```

- Script **tạo tài khoản thử** trong database của máy chủ đang chạy: chỉ dùng với máy dev hoặc bản demo.
- Chạy lại nhiều lần liền có thể chạm giới hạn đăng nhập theo IP (10 lần / 15 phút). Khởi động lại
  server là hết (giới hạn nằm trong bộ nhớ).
- Chrome không ở chỗ mặc định thì đặt `CHROME_PATH`.

## Triển khai (HTTPS)

Chạy đủ bộ PostgreSQL + server + Caddy bằng Docker. Chỉ Caddy mở cổng (80, 443); database và server
nằm trong mạng nội bộ, không ra được Internet (D77–D79).

```bash
cp deploy/.env.example deploy/.env
# Điền POSTGRES_PASSWORD và SERVER_SECRET, mỗi giá trị tạo bằng:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Rồi mở https://localhost. Chứng chỉ do Caddy tự ký nên trình duyệt sẽ cảnh báo lần đầu; đó là bình
thường khi demo trên máy.

- **Tên miền thật:** trỏ DNS về máy chủ, mở cổng 80 và 443, rồi trong `deploy/.env` đặt
  `SITE_ADDRESS=ten-mien-cua-ban` và `HSTS_MAX_AGE=31536000`. Caddy tự xin chứng chỉ Let's Encrypt.
- **Xem log:** `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs -f server`
- **Dừng:** thay `up -d --build` bằng `down`. Thêm `-v` sẽ **xóa luôn dữ liệu** và chứng chỉ.
- Bản triển khai dùng database riêng (volume của project `secure-notes`), không đụng database dev.
- Cổng 80/443 đang bị chương trình khác chiếm (IIS, Skype…) thì phải tắt chương trình đó trước.

## Quy ước làm việc

- **Toàn bộ repo dùng JavaScript + ESM** (`import`/`export`), không TypeScript. Thêm JSDoc cho các hàm quan trọng.
- **GitHub là nguồn sự thật duy nhất.** Cái gì chưa push lên thì coi như chưa có.
- Chỉ 3 người nên commit thẳng lên `main`, không bắt buộc nhánh riêng/Pull Request. Đổi lại: chạy
  `pnpm check` xanh ở máy mình rồi mới push; thay đổi đụng đến ranh giới bảo mật (session, quyền
  truy cập, schema, mã hóa) thì báo nhóm trước khi push để người khác liếc qua.
- Tên nhánh (khi cần tách việc dở dang): `feat/...`, `fix/...`, `chore/...`, `docs/...`.
- Commit: `feat: ...`, `fix: ...`, `test: ...`, `docs: ...`, `chore: ...`, `refactor: ...`.
- Chạy `pnpm format` và `pnpm check` trước khi commit/push.
- Hằng số (tham số Argon2, giới hạn kích thước, thời gian phiên...) chỉ đặt trong `shared/src/config.js`.
- Đổi API thì cập nhật `docs/API.md` và schema trong `shared/` cùng lúc.
- Script trong `package.json` phải chạy được trên cả Windows lẫn Linux (không dùng cú pháp riêng của bash).

## Benchmark Argon2id

Tham số Argon2id (`KDF_DEFAULTS` trong `shared/src/config.js`: `opslimit = 3`, `memlimit = 64 MiB`) là
đánh đổi giữa thời gian chờ khi đăng nhập và chi phí kẻ tấn công phải trả cho mỗi mật khẩu đoán thử khi
lấy được database.

**Kết quả** (máy đo: Intel Core i7-1185G7, 16 GB RAM, Windows 11, Chrome, Node 24; ngày 30/09/2026):

| Đo gì                                         | Mức CPU                                 | Thời gian     |
| --------------------------------------------- | --------------------------------------- | ------------- |
| Một lần Argon2id trong Node (libsodium)       | Bình thường                             | 143 ms        |
| Đăng nhập trọn vẹn trong Chrome (WebAssembly) | Bình thường                             | ~255–300 ms   |
| Như trên                                      | Chậm 4 lần (≈ điện thoại tầm trung)     | ~1,3 giây     |
| Như trên                                      | Chậm 6 lần (≈ điện thoại cấu hình thấp) | ~1,9–2,0 giây |

"Đăng nhập trọn vẹn" tính từ lúc bấm nút tới lúc vào khung làm việc: tra salt, Argon2id, gọi `/login`,
mở khóa và kiểm tra khóa công khai. Mức chậm 4x/6x là giả lập CPU của Chrome (các mức DevTools dùng
cho điện thoại), trung vị của 3 lần đo; giả lập không làm chậm bộ nhớ, nên máy thật yếu có thể chậm hơn
một chút. Dưới 2 giây cho một thao tác chỉ xảy ra khi đăng nhập là chấp nhận được, nên giữ tham số hiện
tại. Mỗi lần đoán thử offline tốn 64 MiB RAM và cỡ 150 ms một nhân CPU hiện đại.

Đo lại:

```bash
pnpm --filter @secure-notes/crypto benchmark                          # Argon2id trong Node, nhiều mức memlimit
BASE=https://localhost/ pnpm --filter @secure-notes/web login-bench   # đăng nhập thật trong Chrome, CPU 1x/4x/6x
```

## Hướng dẫn Demo Giao diện Web (Mã hóa đầu cuối)

> Kịch bản đầy đủ cho buổi thuyết trình, gồm cả phần đóng vai máy chủ bị chiếm quyền và sửa thẳng
> database: [`docs/DEMO.md`](docs/DEMO.md). Tài liệu bảo mật: [`SECURITY.md`](SECURITY.md),
> [`docs/KEY_MANAGEMENT.md`](docs/KEY_MANAGEMENT.md).

Dự án hỗ trợ 2 chế độ khởi chạy web. Tuỳ vào mục đích (test chức năng mạng hay chỉ thiết kế giao diện), bạn có thể chọn 1 trong 2 cách sau:

### 1. Khởi chạy hệ thống

**Cách A: Chạy kết nối với Server thật (Cần Docker)**
Dùng cách này khi bạn muốn demo luồng mạng (Network Tab) và kết nối CSDL thực tế.
Mở 2 cửa sổ Terminal tại thư mục gốc của dự án:

- **Trước đó:** `docker compose -f deploy/docker-compose.yml up -d` (bật PostgreSQL)
- **Terminal 1:** `pnpm run dev:server` (bật máy chủ API)
- **Terminal 2:** `pnpm run dev:web` (bật giao diện web)

**Cách B: Chạy độc lập chỉ Giao diện Web (Chế độ giả lập bộ nhớ)**
Dùng cách này khi máy bạn không có Docker hoặc chỉ muốn test/thiết kế UI nhanh.

1. Mở file `web/src/client.js`.
2. Đổi `createFetchTransport()` thành `createMemoryTransport()`
   _(nhớ thêm `createMemoryTransport` vào dòng import; **không commit** thay đổi này)_.
3. Mở Terminal và gõ: `pnpm run dev:web`. Mọi dữ liệu sẽ lưu tạm trong RAM.

**Cách C: Bản triển khai HTTPS** (giống khi nộp bài nhất): xem mục _Triển khai (HTTPS)_ ở trên,
rồi mở https://localhost.

_Lưu ý:_ Địa chỉ web `http://localhost:5173` (hoặc 5174) chỉ là địa chỉ cục bộ. Khi khởi động lại máy, bạn cần chạy lại lệnh để vào web.

### 2. Kịch bản Demo 1: Kiểm chứng mã hóa mạng (Network Tab)

_(Chỉ dùng được nếu bạn chạy theo Cách A ở trên)_
Để chứng minh văn bản gốc không bao giờ truyền đi trên mạng:

1. Truy cập trang web trên trình duyệt.
2. Bấm **F12** mở Developer Tools, chuyển sang tab **Network** (Mạng) và tích chọn mục _Fetch/XHR_.
3. Đăng nhập và tạo một ghi chú với tiêu đề: "Bí mật", nội dung: "123456", rồi bấm **Lưu**.
4. Tại tab Network, click vào dòng request vừa xuất hiện (có tên dạng ID dài hoặc `notes`).
5. Chuyển sang tab **Payload** (hoặc Request). Bạn sẽ thấy nội dung và tiêu đề đã biến thành các chuỗi mã hóa (`ciphertext`) vô nghĩa. Server hoàn toàn không biết chữ "Bí mật".

### 3. Kịch bản Demo 2: Chia sẻ & Đối chiếu Fingerprint

1. Mở một trình duyệt ẩn danh (Incognito Window), tạo một tài khoản phụ thứ hai (VD: `nguoinhan@example.com`).
2. Trên trình duyệt chứa tài khoản chính, chọn một ghi chú và bấm **Chia sẻ**.
3. Nhập email tài khoản phụ và bấm **Tiếp tục**.
4. Hộp thoại hiển thị **mã khóa (fingerprint)** của người nhận. Bên tài khoản phụ, bấm biểu tượng
   khiên ở góc dưới thanh bên (**Mã xác minh của tôi**): mã này được tính ngay trên máy họ, không lấy
   từ máy chủ. Hai bên đọc mã cho nhau để chắc máy chủ không tráo khóa.
5. Nút **Chia sẻ** chỉ bấm được sau khi tích ô xác nhận đã đối chiếu. Nếu máy chủ đổi khóa giữa lúc
   hiển thị mã và lúc chia sẻ, ứng dụng từ chối (D75).
6. Trình duyệt tài khoản phụ lúc này sẽ nhận được dữ liệu (nhưng vẫn là chuỗi mã hóa qua mạng), và nó tự dùng khóa bí mật của chính nó để giải mã.

### 4. Kịch bản Demo 3: Thu hồi quyền

1. Trong hộp thoại **Chia sẻ**, chuyển sang tab **Người có quyền**.
2. **Thu hồi quyền**: ghi chú được mã hóa lại bằng khóa mới, nên tài khoản phụ không mở được nữa kể cả
   nếu từng giữ khóa cũ. So với **Chỉ gỡ khỏi danh sách**: chỉ máy chủ ngừng cho đọc, khóa không đổi
   (D62).
