import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Chuyển /api về server Fastify để giao diện và API CÙNG origin
    // ngay cả khi chạy dev: không cần CORS, cookie SameSite=Strict vẫn hoạt động.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
