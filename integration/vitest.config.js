import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Mỗi lần đăng ký/đăng nhập chạy Argon2id thật (64 MB, khoảng 0,3 giây) ở phía "trình duyệt".
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Dùng chung database với test của server khi chạy trên PostgreSQL thật (TEST_DATABASE_URL).
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
