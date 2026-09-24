import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Khi chạy với PostgreSQL thật (TEST_DATABASE_URL), các file test cùng dùng một database và xóa
    // sạch bảng trước mỗi test, nên phải chạy lần lượt từng file. Với DB giả thì chạy song song bình thường.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
