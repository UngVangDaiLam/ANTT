# Chính sách bảo mật

## Báo lỗ hổng

Phát hiện lỗ hổng trong Secure Notes: **không** mở issue công khai. Nhắn riêng cho nhóm (qua kênh liên
lạc của lớp học phần) kèm mô tả, cách tái hiện và mức ảnh hưởng. Nhóm xác nhận đã nhận trong vòng 2
ngày làm việc.

## Thời hạn vá thư viện có lỗ hổng (ASVS 15.1.1)

Tính từ lúc lỗ hổng được công bố hoặc được `pnpm audit` / CI phát hiện, theo mức nghiêm trọng của
advisory (thang CVSS mà `pnpm audit` báo):

| Mức      | Thời hạn vá                             | Ghi chú                                                                                |
| -------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| Critical | 2 ngày làm việc                         | Nếu chưa có bản vá: gỡ hoặc thay thư viện, hoặc tắt chức năng dùng tới nó              |
| High     | 1 tuần làm việc                         | CI **chặn** mọi push khi còn lỗ hổng mức này trở lên (`pnpm audit --audit-level high`) |
| Moderate | 2 tuần, hoặc trước lần nộp bài gần nhất | Đánh giá xem đoạn mã có lỗ hổng có thật sự chạy trong hệ thống không                   |
| Low      | Lần cập nhật thư viện định kỳ kế tiếp   | —                                                                                      |

Lỗ hổng nằm trong thư viện chỉ dùng khi phát triển (devDependencies, không vào bản build chạy cho
người dùng) được hạ một mức, nhưng vẫn phải vá vì chúng chạy trên máy của nhóm và trên CI.

Khi chưa nâng được thư viện trực tiếp (lỗ hổng ở phụ thuộc gián tiếp), dùng `overrides` trong
`pnpm-workspace.yaml` để ép phiên bản đã vá, như đã làm với `deepmerge-ts`.

## Kiểm soát chuỗi cung ứng đang áp dụng

- **CI chạy `pnpm audit --audit-level high` ở mỗi lần push**; có lỗ hổng High/Critical là CI đỏ.
- **Khóa phiên bản:** cài bằng `pnpm install --frozen-lockfile` (CI và Docker), không tự nâng phiên bản.
- **Chặn script cài đặt:** pnpm 10 mặc định không chạy script của gói; chỉ gói trong
  `onlyBuiltDependencies` (Prisma) được chạy.
- **Thêm thư viện mới phải hỏi nhóm trước** (CLAUDE.md), ghi lý do vào `docs/DECISIONS.md` (ví dụ D84).
- **Giao diện không tải gì từ bên ngoài** (D72) và CSP chặn mọi nguồn ngoài, nên thư viện chỉ đến từ
  bản build đã kiểm soát.
- **Cập nhật định kỳ:** mỗi tuần một người chạy `pnpm audit` và `pnpm outdated`, nâng các bản vá
  (patch) và chạy `pnpm check` trước khi push.

## Phạm vi

Mô hình mối đe dọa và những gì hệ thống **không** chống được: `docs/THREAT_MODEL.md`. Quản lý khóa:
`docs/KEY_MANAGEMENT.md`. Đối chiếu ASVS: `docs/ASVS.md`.
