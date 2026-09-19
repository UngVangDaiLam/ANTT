# Threat model

## 1. Tài sản cần bảo vệ

<!-- Nội dung và tiêu đề note, khóa, mật khẩu, metadata... -->

## 2. Giả định

<!-- Máy chủ không tin cậy; trình duyệt và máy người dùng tin cậy; TLS khi deploy... -->

## 3. Kẻ tấn công

| Kẻ tấn công          | Khả năng | Phòng thủ | Phụ trách |
| -------------------- | -------- | --------- | --------- |
| Server tò mò         |          |           | Lâm       |
| Server độc hại       |          |           | Lâm       |
| Kẻ trộm database     |          |           | Trần Bảo  |
| Kẻ nghe lén mạng     |          |           | Trần Bảo  |
| Kẻ dò mật khẩu       |          |           | Trần Bảo  |
| XSS                  |          |           | Trần Bảo  |
| Thư viện npm độc hại |          |           | Trần Bảo  |
| Prototype Pollution  |          |           | Trần Bảo  |

## 4. Những gì hệ thống KHÔNG bảo vệ được

<!-- Server gửi mã JS độc ngay từ đầu; máy người dùng nhiễm mã độc; rollback ở lần đọc đầu trên
thiết bị mới; người nhận đã đọc trước khi bị thu hồi; metadata còn lộ (thời gian, kích thước, ai chia sẻ cho ai)... -->

## 5. Metadata server vẫn thấy
