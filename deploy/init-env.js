/**
 * Tạo hoặc bổ sung deploy/.env để bật bản triển khai bằng một lệnh (D92).
 *
 *   node deploy/init-env.js        # hoặc: pnpm deploy:env (pnpm deploy:up đã gọi sẵn)
 *
 * - Chưa có deploy/.env: chép từ deploy/.env.example, điền bí mật ngẫu nhiên vào mọi ô bí mật còn trống.
 * - Đã có: GIỮ NGUYÊN mọi giá trị đang có, chỉ thêm hoặc điền những bí mật còn thiếu. Không bao giờ
 *   đổi POSTGRES_PASSWORD đã có: database trong volume đã khởi tạo bằng mật khẩu đó.
 * - Không in giá trị bí mật ra màn hình, chỉ in tên biến vừa tạo.
 *
 * Chạy lại bao nhiêu lần cũng được. Muốn đổi một bí mật: xóa giá trị của nó trong deploy/.env rồi chạy
 * lại (trừ POSTGRES_PASSWORD, xem trên).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Các biến sinh ngẫu nhiên. base64url để dùng được thẳng trong URL kết nối database. */
const SECRETS = ['POSTGRES_PASSWORD', 'MIGRATE_DB_PASSWORD', 'APP_DB_PASSWORD', 'SERVER_SECRET'];

const envPath = fileURLToPath(new URL('.env', import.meta.url));
const examplePath = fileURLToPath(new URL('.env.example', import.meta.url));

const newSecret = () => randomBytes(32).toString('base64url');

const existed = existsSync(envPath);
let lines = readFileSync(existed ? envPath : examplePath, 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n');

const created = [];
for (const name of SECRETS) {
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index === -1) {
    if (lines.at(-1) === '') lines.pop();
    lines.push(`${name}=${newSecret()}`, '');
    created.push(name);
  } else if (lines[index].slice(name.length + 1).trim() === '') {
    lines[index] = `${name}=${newSecret()}`;
    created.push(name);
  }
}

if (!existed || created.length > 0) {
  writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
}

if (!existed) {
  console.log(`Đã tạo deploy/.env với bí mật ngẫu nhiên: ${created.join(', ')}.`);
} else if (created.length > 0) {
  console.log(`Đã bổ sung vào deploy/.env: ${created.join(', ')}. Các giá trị cũ giữ nguyên.`);
} else {
  console.log('deploy/.env đã đủ, không đổi gì.');
}
