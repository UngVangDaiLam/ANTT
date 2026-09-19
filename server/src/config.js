/** Đọc cấu hình từ biến môi trường. Chạy với: node --env-file=.env ... hoặc Docker. */
export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const serverSecret = env.SERVER_SECRET ?? 'dev-only-secret';
  if (isProduction && (!env.SERVER_SECRET || env.SERVER_SECRET === 'doi-gia-tri-nay')) {
    throw new Error('SERVER_SECRET phải được đặt khi chạy production');
  }
  return Object.freeze({
    isProduction,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    serverSecret,
  });
}
