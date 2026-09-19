# Secure Notes

Ứng dụng web ghi chú mã hóa đầu cuối dựa trên mật mã lai X25519 – XChaCha20-Poly1305.

Giả định xuyên suốt: **máy chủ không tin cậy**. Mọi mã hóa và giải mã diễn ra ở trình duyệt;
server chỉ là kho lưu trữ mù.

## Cấu trúc

| Thư mục       | Người phụ trách | Vai trò                                                         |
| ------------- | --------------- | --------------------------------------------------------------- |
| `shared/`     | Lâm + Trần Bảo  | Schema API (TypeBox), hằng số cấu hình, mã lỗi. Không có mật mã |
| `crypto/`     | Lâm             | Module mật mã thuần, không gọi mạng                             |
| `client-sdk/` | Lâm             | Cầu nối: gọi `crypto/` và API, trả kết quả đơn giản cho web     |
| `server/`     | Trần Bảo        | Fastify + PostgreSQL, kho lưu trữ mù                            |
| `web/`        | Phan Bảo        | React + Vite, chỉ gọi `client-sdk/`                             |
| `docs/`       | Cả nhóm         | API, quyết định thiết kế, threat model, bảng ASVS               |
| `deploy/`     | Trần Bảo        | Docker Compose, Caddy                                           |

## Ranh giới bắt buộc

Kiểm tra tự động bằng `pnpm depcheck` (dependency-cruiser), CI sẽ báo lỗi nếu vi phạm:

- `server/` không import `crypto/`, `client-sdk/` hay libsodium.
- `web/` chỉ import `client-sdk/`.
- `crypto/` không biết gì về mạng, server hay giao diện.
- `shared/` không phụ thuộc gói nào khác của dự án.

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

## Chuyển code của Lâm vào repo này

1. Chép `src/kdf.js`, `vault.js`, `note.js`, `sharing.js` vào `crypto/src/`; test tương ứng vào `crypto/test/`; benchmark vào
   `crypto/benchmark/` (**còn thiếu**: `argon2-benchmark.js` vẫn ở thư mục gốc `benchmark/`, chưa chuyển
   vào `crypto/benchmark/` — script `benchmark` trong `crypto/package.json` sẽ lỗi cho đến khi chuyển).
2. Chép `src/client.js`, `fetchTransport.js`, `memoryTransport.js` vào `client-sdk/src/`; `client.test.js` vào `client-sdk/test/`.
3. Đổi `require(...)` thành `import`, `module.exports` thành `export`. Trong test, đổi import của Jest sang `import { describe, test, expect } from 'vitest'`.
4. Dùng `libsodium-wrappers-sumo` bản 0.8.x đã khai báo sẵn trong `crypto/package.json` (bản 0.7.x lỗi khi import ESM, xem D32).
5. Export lại trong `crypto/src/index.js` và `client-sdk/src/index.js` (có hướng dẫn sẵn trong file).
6. `client-sdk` import crypto bằng `import { ... } from '@secure-notes/crypto'`, không dùng đường dẫn tương đối sang thư mục khác.
7. Chạy `pnpm check` cho đến khi qua hết rồi commit. Các thay đổi đã chốt trong `docs/DECISIONS.md` làm ở commit sau, để
   commit này chỉ là chuyển code.
