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

```bash
corepack enable            # bật pnpm đúng phiên bản ghi trong package.json
pnpm install
pnpm check                 # lint + format + ranh giới kiến trúc + test
pnpm --filter @secure-notes/server db:validate   # kiểm tra schema Prisma

# Chạy server
docker compose -f deploy/docker-compose.yml up -d
cp server/.env.example server/.env
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

Tham số Argon2id (`KDF_DEFAULTS` trong `shared/src/config.js`) là đánh đổi giữa trải nghiệm và chi phí
mà kẻ tấn công phải trả cho mỗi mật khẩu đoán thử khi chúng lấy được database. Đo trên máy mình:

```bash
pnpm --filter @secure-notes/crypto benchmark
```

Nên chạy thêm trên một máy yếu hơn và trên trình duyệt di động rồi ghi số liệu vào báo cáo.
