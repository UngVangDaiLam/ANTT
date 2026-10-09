import { afterAll } from 'vitest';
import { createFakeDb } from './fake-db.js';

/**
 * Các "DB" mà bộ test route được chạy trên đó.
 *
 *  - `fake`: DB giả trong bộ nhớ, luôn chạy, rất nhanh.
 *  - `postgres`: PostgreSQL thật qua Prisma, chỉ chạy khi đặt `TEST_DATABASE_URL`. ĐÂY là bản chứng
 *    minh câu truy vấn Prisma trong route chạy đúng, và cũng là thước đo để biết DB giả có trung
 *    thực không: cả hai phải cho kết quả giống nhau trên cùng một bộ test.
 *  - `postgres-app-role`: như `postgres` nhưng server kết nối bằng role app chỉ có quyền tối thiểu
 *    (D90), giống bản triển khai.
 *
 * `backend.admin(db)` là kết nối để TEST tự sửa dữ liệu (ví dụ lùi thời điểm trong lịch sử đăng
 * nhập), việc server không bao giờ làm nên role app không có quyền.
 *
 * Chạy với Postgres thật:
 *   docker compose -f deploy/docker-compose.yml up -d
 *   TEST_DATABASE_URL=postgresql://securenotes:securenotes@localhost:5433/securenotes_test \
 *     pnpm --filter @secure-notes/server test
 *
 * CẢNH BÁO: các bảng trong database đó bị XÓA SẠCH trước mỗi test. Tuyệt đối không trỏ vào database
 * dev đang có dữ liệu.
 */
const url = process.env.TEST_DATABASE_URL;

let prisma;
let appRole;

if (url) {
  // Import lười: chạy test mà không có Postgres thì không cần Prisma client đã được sinh.
  const { PrismaClient } = await import('@prisma/client');
  const { connectWithRoles } = await import('./db-roles.js');
  prisma = new PrismaClient({ datasourceUrl: url });
  const roles = await connectWithRoles(prisma, url);
  await roles.migrate.$disconnect();
  appRole = roles.app;
  afterAll(() => Promise.all([prisma.$disconnect(), appRole.$disconnect()]));
}

async function resetPostgres() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "LoginHistory", "Session", "Share", "Note", "User" RESTART IDENTITY CASCADE',
  );
}

export const backends = [
  { name: 'fake', create: async () => createFakeDb(), admin: (db) => db },
  ...(url
    ? [
        {
          name: 'postgres',
          create: async () => {
            await resetPostgres();
            return prisma;
          },
          admin: () => prisma,
        },
        {
          // Cùng database nhưng server kết nối bằng role app như bản triển khai (D90): chứng minh
          // mọi route vẫn chạy với quyền tối thiểu. Xóa bảng vẫn bằng superuser, vì role app không có
          // quyền TRUNCATE.
          name: 'postgres-app-role',
          create: async () => {
            await resetPostgres();
            return appRole;
          },
          admin: () => prisma,
        },
      ]
    : []),
];

/** Đợi một chút để hai lần ghi liên tiếp có `updatedAt` khác nhau (cột chỉ chính xác tới mili giây). */
export const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
