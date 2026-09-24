/**
 * Sinh lại src/commonPasswords.js từ danh sách mật khẩu phổ biến của NCSC (Trung tâm An ninh mạng
 * Quốc gia Anh, lấy từ dữ liệu rò rỉ thật trên Have I Been Pwned), qua bộ SecLists (giấy phép MIT).
 *
 * Chạy: pnpm --filter @secure-notes/client-sdk build:common-passwords
 *
 * Nguồn được GHIM theo một commit cố định và kiểm tra mã băm SHA-256: nếu nội dung tải về khác dù chỉ
 * một byte (repo nguồn bị sửa, bị chiếm quyền, hay đường truyền bị can thiệp) thì script dừng và KHÔNG
 * ghi gì. Muốn cập nhật danh sách, đổi SOURCE_COMMIT và SOURCE_SHA256 có chủ đích, rồi xem lại diff.
 *
 * Chỉ chạy lúc phát triển; ứng dụng không bao giờ gọi mạng để lấy danh sách này.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PASSWORD_POLICY } from '@secure-notes/shared';

const SOURCE_COMMIT = 'eccfbd405af82194e125a450a0076dbe4252d6f9';
const SOURCE_PATH = 'Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt';
const SOURCE_URL = `https://raw.githubusercontent.com/danielmiessler/SecLists/${SOURCE_COMMIT}/${SOURCE_PATH}`;
const SOURCE_SHA256 = 'c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0';

const OUTPUT = fileURLToPath(new URL('../src/commonPasswords.js', import.meta.url));

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`Tải thất bại: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());

const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== SOURCE_SHA256) {
  throw new Error(`Mã băm không khớp: chờ ${SOURCE_SHA256}, nhận ${actual}. Không ghi gì.`);
}

// ASVS 6.2.4: "top 3000 passwords which match the application's password policy". Lọc theo độ dài
// TRƯỚC rồi mới lấy 3000 cái đầu; lọc sau thì danh sách toàn chuỗi ngắn vốn đã bị chặn sẵn. Danh sách
// gốc đã xếp theo tần suất. So sánh không phân biệt hoa thường, nên lưu dạng chữ thường và bỏ trùng.
const selected = [];
const seen = new Set();
for (const line of bytes.toString('utf8').split(/\r?\n/)) {
  if ([...line].length < PASSWORD_POLICY.MIN_LENGTH) continue;
  const lower = line.toLowerCase();
  if (seen.has(lower)) continue;
  seen.add(lower);
  selected.push(lower);
  if (selected.length === PASSWORD_POLICY.COMMON_LIST_SIZE) break;
}
if (selected.length !== PASSWORD_POLICY.COMMON_LIST_SIZE) {
  throw new Error(
    `Chỉ lọc được ${selected.length} mật khẩu, cần ${PASSWORD_POLICY.COMMON_LIST_SIZE}.`,
  );
}

const output = `/**
 * FILE SINH TỰ ĐỘNG bởi scripts/build-common-passwords.js — đừng sửa tay.
 *
 * ${PASSWORD_POLICY.COMMON_LIST_SIZE} mật khẩu phổ biến nhất có ít nhất ${PASSWORD_POLICY.MIN_LENGTH} ký tự (ASVS 6.2.4), chữ thường.
 * Nguồn: NCSC 100k most used passwords, qua SecLists (MIT)
 *   ${SOURCE_URL}
 *   SHA-256 của file nguồn: ${SOURCE_SHA256}
 *
 * Một chuỗi duy nhất (thay vì mảng ${PASSWORD_POLICY.COMMON_LIST_SIZE} phần tử) để file gọn và Prettier không trải ra hàng nghìn dòng.
 */
const RAW = ${JSON.stringify(selected.join('\n'))};

/** @type {ReadonlySet<string>} */
export const COMMON_PASSWORDS = new Set(RAW.split('\\n'));
`;

writeFileSync(OUTPUT, output);
console.log(`Đã ghi ${selected.length} mật khẩu vào ${OUTPUT}`);
