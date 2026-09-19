import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { AppError, LIMITS } from '@secure-notes/shared';
import { loadConfig } from './config.js';
import securityPlugin from './plugins/security.js';
import errorsPlugin from './plugins/errors.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';

/**
 * Tạo ứng dụng Fastify. Tách khỏi server.js để test bằng app.inject()
 * mà không cần mở cổng mạng.
 * @param {object} [options]
 * @param {ReturnType<typeof loadConfig>} [options.config]
 * @param {boolean | object} [options.logger]
 * @param {object} [options.db] Prisma client; test truyền đối tượng giả cùng giao diện.
 */
export async function buildApp({ config = loadConfig(), logger = false, db } = {}) {
  const app = Fastify({
    logger,
    bodyLimit: LIMITS.MAX_REQUEST_BYTES,
    // Mặc định của Fastify là 'error', ghi rõ ra để thể hiện chủ đích:
    // request JSON chứa __proto__ hoặc constructor.prototype bị từ chối ngay.
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
    ajv: {
      customOptions: {
        // Mặc định Fastify tự XÓA trường lạ rồi cho qua. Tắt đi để trường lạ
        // bị TỪ CHỐI hẳn (kết hợp additionalProperties: false trong schema).
        removeAdditional: false,
      },
    },
  });

  app.decorate('config', config);
  app.decorate('db', db);

  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false, // bật riêng cho từng route nhạy cảm (login, salt...)
    errorResponseBuilder: () => new AppError('RATE_LIMITED'),
  });
  await app.register(swagger, {
    openapi: { info: { title: 'Secure Notes API', version: '0.1.0' } },
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      api.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());
      await api.register(authRoutes);
      // TODO [Trần Bảo]: đăng ký các route còn lại theo docs/API.md
      // await api.register(noteRoutes);
      // await api.register(shareRoutes);
      // await api.register(sessionRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
