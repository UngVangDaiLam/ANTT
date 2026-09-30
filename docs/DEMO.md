# Kịch bản demo

Khoảng 15 phút. Mục tiêu: cho thấy (1) máy chủ không đọc được ghi chú, và (2) kể cả khi máy chủ bị
chiếm quyền và cố tình sửa dữ liệu, ứng dụng vẫn phát hiện và từ chối. Phần (2) là điểm khác biệt
của đồ án, nên dành nhiều thời gian nhất cho nó.

Mọi lệnh và mọi phản ứng của ứng dụng trong kịch bản này đã được chạy thử trên bản triển khai.

## Chuẩn bị (trước giờ demo)

1. Bật bản triển khai HTTPS (README, mục _Triển khai_):

   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env restart server
   ```

   Lệnh `restart server` xóa bộ đếm rate limit (nằm trong bộ nhớ), để lúc diễn tập không làm demo bị
   chặn.

2. Mở **hai cửa sổ trình duyệt**: một cửa sổ thường cho **Alice**, một cửa sổ ẩn danh cho **Bob**, cùng vào
   https://localhost (bấm qua cảnh báo chứng chỉ tự ký).

3. Mở một terminal "máy chủ bị chiếm", vào thẳng database:

   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec db psql -U securenotes -d securenotes
   ```

4. Chọn sẵn email không trùng với lần diễn tập, ví dụ `alice@demo.vn`, `bob@demo.vn`, `mallory@demo.vn`.
   Các câu SQL dưới đây dùng đúng các email này; đổi email thì sửa theo.

## Phần 1: Máy chủ không đọc được gì (4 phút)

**1.1 Đăng ký.** Ở cửa sổ Alice, chọn _Đăng ký_, gõ thử mật khẩu `password1`:

- Giao diện báo ngay mật khẩu nằm trong danh sách phổ biến và khóa nút (ASVS 6.2.4).
- Chỉ ra dòng cảnh báo "quên mật khẩu là mất toàn bộ ghi chú": vì máy chủ không giữ khóa, không ai
  khôi phục được.
- Đăng ký bằng mật khẩu dài. Làm tương tự cho Bob (cửa sổ ẩn danh) và **Mallory** (đăng ký ở cửa sổ
  Bob rồi đăng xuất, đăng nhập lại Bob).

**1.2 Tạo ghi chú, xem tab Network.** Mở DevTools (F12), tab _Network_. Alice tạo hai ghi chú, theo đúng
thứ tự:

1. Tiêu đề `Lương tháng 9`, nội dung `25.000.000 đồng`.
2. Tiêu đề `Mật khẩu wifi`, nội dung `nha-minh-2026`.

Bấm vào request `PUT /api/notes/...`: body chỉ có `nonce` và `ciphertext`, không có chữ nào của ghi chú.

**1.3 Nhìn từ phía máy chủ.** Ở terminal database:

```sql
SELECT n.id, n.version, n."encryptedTitle"->>'ciphertext' AS tieu_de
FROM "Note" n JOIN "User" u ON u.id = n."ownerId"
WHERE u.email = 'alice@demo.vn' ORDER BY n."createdAt";
```

Nói: "Đây là toàn bộ những gì máy chủ có. Nó không biết ghi chú nào là lương, ghi chú nào là wifi."
**Chép lại hai id**: dòng đầu là _Lương tháng 9_, dòng sau là _Mật khẩu wifi_.

## Phần 2: Chia sẻ an toàn (3 phút)

**2.1 Đối chiếu mã.** Alice mở _Lương tháng 9_ → _Chia sẻ_ → nhập email Bob → _Tiếp tục_.

- Nút _Chia sẻ_ bị khóa cho tới khi tick "đã đối chiếu".
- Ở cửa sổ Bob, bấm biểu tượng khiên ở chân thanh bên (_Mã xác minh của tôi_). Mã khớp với mã Alice
  đang thấy. Nói: mã của Bob được tính ngay trên máy Bob từ khóa riêng, không hỏi máy chủ (D70).
- Tick, chia sẻ. Bob thấy ghi chú trong mục _Được chia sẻ với tôi_, mở ra đọc được, chỉ đọc.

**2.2 Thu hồi quyền.** Alice → _Chia sẻ_ → tab _Người có quyền_ → _Thu hồi quyền_. Đọc to phần giải thích:
ghi chú được mã hóa lại bằng khóa mới, khác với _Chỉ gỡ khỏi danh sách_. Bob tải lại: ghi chú biến mất.

## Phần 3: Máy chủ bị chiếm quyền (5 phút)

Nói: "Giờ nhóm đóng vai kẻ đã chiếm được máy chủ, sửa thẳng database. Ứng dụng có bị lừa không?"

**3.1 Tráo nội dung giữa hai ghi chú.** Gắn nội dung ghi chú wifi vào ghi chú lương (dán hai id đã chép):

```sql
UPDATE "Note" SET "encryptedContent" =
  (SELECT "encryptedContent" FROM "Note" WHERE id = '<ID_WIFI>')
WHERE id = '<ID_LUONG>';
```

Alice mở _Lương tháng 9_: hiện **"Đã chặn dữ liệu không an toàn"**, không hiện nội dung. Mở _Mật khẩu
wifi_: vẫn đọc bình thường.

Giải thích: ciphertext vẫn là ciphertext thật, giải mã được về mặt toán học, nhưng mỗi ciphertext gắn
với đúng id ghi chú, phiên bản và trường của nó (Associated Data, D19). Đem sang chỗ khác là bị lộ.

**3.2 Trả về bản cũ (rollback).** Alice tạo ghi chú `Kế hoạch`, nội dung `Họp thứ Hai`, lưu. Máy chủ
chụp lại bản này:

```sql
CREATE TABLE demo_backup AS
SELECT n.* FROM "Note" n JOIN "User" u ON u.id = n."ownerId"
WHERE u.email = 'alice@demo.vn' ORDER BY n."createdAt" DESC LIMIT 1;
```

Alice sửa thành `ĐỔI sang thứ Tư`, lưu. Máy chủ lén trả lại bản cũ:

```sql
UPDATE "Note" n SET version = b.version,
  "encryptedTitle" = b."encryptedTitle", "encryptedContent" = b."encryptedContent"
FROM demo_backup b WHERE n.id = b.id;
DROP TABLE demo_backup;
```

Alice bấm sang ghi chú khác rồi mở lại _Kế hoạch_: hiện cảnh báo **máy chủ gửi về phiên bản cũ hơn
bản đã thấy**. Bản cũ hoàn toàn "hợp lệ" (chữ ký, AD đều đúng), chỉ bị phát hiện vì trình duyệt nhớ
số phiên bản cao nhất đã thấy (D20).

Nói luôn giới hạn: một thiết bị **chưa từng** thấy bản mới thì không có gì để so, nên sẽ nhận bản cũ
(THREAT_MODEL, giới hạn 4). Đã thử: đăng nhập ở máy khác sẽ đọc được "Họp thứ Hai".

**3.3 Tráo khóa công khai (tấn công người đứng giữa).** Máy chủ đưa khóa của Mallory thay cho khóa của
Bob:

```sql
UPDATE "User" SET "x25519PublicKey" =
  (SELECT "x25519PublicKey" FROM "User" WHERE email = 'mallory@demo.vn')
WHERE email = 'bob@demo.vn';
```

- Alice chia sẻ một ghi chú cho Bob: mã hiện ra **khác** mã trong _Mã xác minh của tôi_ của Bob (Bob
  vẫn đang đăng nhập nên mã vẫn tính từ khóa thật của Bob). Đối chiếu là phát hiện, không tick.
- Bob đăng xuất rồi đăng nhập lại: bị chặn, vì khóa công khai máy chủ trả về không khớp khóa riêng của
  Bob (D70).
- Nói giới hạn: nếu người dùng tick cho có mà không đối chiếu thật, phòng thủ này vô dụng
  (THREAT_MODEL, giới hạn 7).

## Phần 4: Chống đoán mật khẩu và quản lý phiên (2 phút)

**4.1 Đoán mật khẩu.** Trước tiên khởi động lại server để xóa bộ đếm theo IP (nằm trong bộ nhớ), nhờ vậy
lần bị chặn dưới đây chắc chắn là do giới hạn theo **tài khoản** (lưu trong database):

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env restart server
```

Ở cửa sổ Bob, đăng nhập bằng tài khoản **Mallory** (Bob đã bị chặn ở 3.3). Nhập sai mật khẩu 5 lần, rồi
nhập **đúng**: vẫn bị chặn "thử quá nhiều lần". Giải thích: giới hạn tính theo tài
khoản chứ không theo IP (D81), chờ lâu dần tới 15 phút, không khóa hẳn để kẻ xấu không khóa được tài
khoản người khác; email chưa đăng ký bị chặn y hệt để không dò được ai có tài khoản.

**4.2 Thiết bị và lịch sử.** Alice bấm biểu tượng màn hình ở chân thanh bên (_Tài khoản và bảo mật_):

- Tab _Thiết bị_: đăng xuất một thiết bị khác phải nhập lại mật khẩu (ASVS 7.5.2).
- Tab _Lịch sử_: có cả lần nhập sai mật khẩu, có cảnh báo nếu có lần sai.
- Nhắc: ứng dụng tự khóa sau 15 phút không thao tác và xóa khóa khỏi bộ nhớ (không cần chờ để demo).

## Kết (1 phút)

Những gì hệ thống **không** chống được, nói thẳng thay vì để bị hỏi:

- Máy chủ vẫn thấy metadata: ai có bao nhiêu ghi chú, sửa lúc nào, chia sẻ cho ai.
- Rollback trên thiết bị chưa từng thấy bản mới (3.2).
- Đối chiếu mã là việc thủ công (3.3).
- Quên mật khẩu là mất dữ liệu: đánh đổi có chủ đích của mã hóa đầu cuối.
- Máy chủ bị chiếm hoàn toàn có thể gửi mã JavaScript độc cho trình duyệt: giới hạn chung của mọi ứng
  dụng web mã hóa đầu cuối (THREAT_MODEL, giới hạn 1).

## Sự cố thường gặp

| Hiện tượng                            | Cách xử lý                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------- |
| "Bạn thử quá nhiều lần" ngoài dự kiến | Diễn tập đã dùng hết rate limit theo IP: `restart server` như bước chuẩn bị |
| Đăng ký báo email đã có               | Đổi sang email khác, nhớ sửa email trong các câu SQL                        |
| Trình duyệt cảnh báo chứng chỉ        | Bình thường với `localhost`; chọn tiếp tục                                  |
| Muốn làm lại từ đầu                   | Đổi bộ email mới, hoặc `down -v` rồi `up` lại (xóa sạch dữ liệu demo)       |
