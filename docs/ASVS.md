# Đối chiếu OWASP ASVS 5.0.0

Kiểm tra lại tên và nội dung từng chương với tài liệu gốc trên GitHub OWASP/ASVS trước khi điền.

Cột "Mức đáp ứng": Đạt / Một phần / Không áp dụng / Vượt yêu cầu (theo mô hình E2EE, ghi rõ lý do).

| Mã yêu cầu | Nội dung tóm tắt | Mức đáp ứng | Thực hiện ở đâu (file, test) | Ghi chú |
| ---------- | ---------------- | ----------- | ---------------------------- | ------- |
|            |                  |             |                              |         |

## Các chương

V1 Encoding and Sanitization · V2 Validation and Business Logic · V3 Web Frontend Security ·
V4 API and Web Service · V5 File Handling · V6 Authentication · V7 Session Management ·
V8 Authorization · V9 Self-contained Tokens · V10 OAuth and OIDC · V11 Cryptography ·
V12 Secure Communication · V13 Configuration · V14 Data Protection ·
V15 Secure Coding and Architecture · V16 Security Logging and Error Handling · V17 WebRTC

Với V11 và V14: nhiều yêu cầu giả định server tự mã hóa dữ liệu. Ở mô hình này server không bao giờ
thấy nội dung hay khóa, nên ghi "Vượt yêu cầu" kèm giải thích thay vì "Không đạt".
