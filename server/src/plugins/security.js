import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import { AppError } from '@secure-notes/shared';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function securityPlugin(app) {
  // Header bảo mật cho phản hồi API. CSP của trang web (HTML) đặt ở Caddy,
  // xem deploy/Caddyfile, vì Caddy mới là nơi phục vụ giao diện.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: app.config.isProduction,
  });

  // Chống CSRF: request thay đổi dữ liệu mà có Origin lạ thì từ chối.
  // (Kết hợp với cookie SameSite=Strict.)
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !app.config.allowedOrigins.includes(origin)) {
      throw new AppError('FORBIDDEN');
    }
  });
}

export default fp(securityPlugin, { name: 'security' });
