import { AppError, RATE_LIMITS, RegisterRequest, normalizeEmail } from '@secure-notes/shared';
import { hashAuthKey } from '../lib/auth-key.js';

/** Mã lỗi Prisma khi vi phạm ràng buộc unique. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Route tài khoản. Cần `app.db` là Prisma client (hoặc đối tượng giả cùng giao diện khi test).
 * @param {import('fastify').FastifyInstance} app
 */
export default async function authRoutes(app) {
  app.post(
    '/register',
    {
      schema: { body: RegisterRequest },
      config: {
        rateLimit: {
          max: RATE_LIMITS.REGISTER.max,
          timeWindow: RATE_LIMITS.REGISTER.timeWindowMs,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      try {
        // Không kiểm tra trước bằng findUnique: ràng buộc unique của DB là nguồn sự thật duy nhất,
        // tránh race condition khi hai request cùng email đến đồng thời.
        await app.db.user.create({
          data: {
            email: normalizeEmail(body.email),
            salt: body.salt,
            kdfOpslimit: body.kdfParams.opslimit,
            kdfMemlimit: body.kdfParams.memlimit,
            authKeyHash: hashAuthKey(body.authKey), // D14: không lưu authKey gốc
            wrappedVaultKey: body.wrappedVaultKey,
            x25519PublicKey: body.x25519PublicKey,
            ed25519PublicKey: body.ed25519PublicKey,
            wrappedX25519PrivateKey: body.wrappedX25519PrivateKey,
            wrappedEd25519PrivateKey: body.wrappedEd25519PrivateKey,
          },
          select: { id: true },
        });
      } catch (err) {
        if (err?.code === PRISMA_UNIQUE_VIOLATION) throw new AppError('EMAIL_TAKEN');
        throw err;
      }
      // Đăng ký không tạo phiên; client gọi /api/login sau đó.
      return reply.code(201).send();
    },
  );
}
