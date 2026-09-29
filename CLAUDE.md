# Bối cảnh cho Claude Code

Đồ án học phần Lập trình An toàn thông tin: ứng dụng web ghi chú mã hóa đầu cuối dựa trên mật mã lai
X25519 – XChaCha20-Poly1305. Nhóm 3 người: Lâm (`crypto/`, `client-sdk/`), Trần Bảo (`server/`,
`deploy/`), Phan Bảo (`web/`). Trả lời bằng tiếng Việt.

Giả định xuyên suốt: **máy chủ không tin cậy**. Mọi mã hóa diễn ra ở trình duyệt; server chỉ lưu và
trung chuyển dữ liệu đã mã hóa.

## Đọc trước khi làm

- `docs/DECISIONS.md`: các quyết định đã chốt. Không tự ý làm trái; nếu thấy cần đổi, hỏi trước.
- `docs/API.md`: hợp đồng API giữa client-sdk và server.
- `README.md`: cấu trúc repo và quy ước làm việc.

## Quy tắc bắt buộc

- JavaScript + ESM (`import`/`export`), không TypeScript. Thêm JSDoc cho hàm công khai.
- Ranh giới: `server/` không import `crypto/`, `client-sdk/` hay libsodium; `web/` chỉ import `client-sdk/`;
  `crypto/` không gọi mạng; `integration/` (chỉ chứa test) là nơi duy nhất được dùng cả `client-sdk/` lẫn
  `server/`, và không ai được import ngược vào nó. Kiểm tra bằng `pnpm depcheck`.
- Hằng số chỉ đặt trong `shared/src/config.js`. Mã lỗi trong `shared/src/errors.js`, định dạng `{ code, message }`.
- Server lấy danh tính từ session, không tin email hay id người dùng do client gửi. Kiểm tra quyền trên mọi route;
  note không thuộc về người gọi trả `NOT_FOUND`.
- Mọi object trong schema có `additionalProperties: false`. Client kiểm tra response bằng `Value.Check` của TypeBox,
  không dùng ajv.
- Không lưu khóa vào localStorage. Không dùng `dangerouslySetInnerHTML`, `eval`, `new Function`, `__proto__`.
- Không log authKey, cookie, khóa hay ciphertext.
- Đổi API thì cập nhật `docs/API.md` và schema trong `shared/` cùng lúc. Quyết định mới ghi vào `docs/DECISIONS.md`.
- Mỗi tính năng có test cho cả trường hợp thành công lẫn trường hợp phải thất bại.

## Lệnh

- `pnpm check`: lint, format, ranh giới kiến trúc, toàn bộ test. Chạy trước khi báo xong việc.
- `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm depcheck`
- `pnpm dev:server`, `pnpm dev:web`
- `pnpm --filter @secure-notes/server db:migrate`

## Không được làm

- Không commit, push hay merge thay người dùng trừ khi được yêu cầu rõ.
- Không sửa file của thành viên khác nếu không được yêu cầu.
- Không thêm thư viện mới khi chưa hỏi (rủi ro chuỗi cung ứng).
