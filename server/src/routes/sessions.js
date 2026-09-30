import {
  AUTH_ATTEMPT_KINDS,
  AppError,
  LIMITS,
  LoginHistoryResponse,
  RATE_LIMITS,
  RevokeSessionsRequest,
  RevokeSessionsResponse,
  SessionListResponse,
} from '@secure-notes/shared';
import { enforceAccountThrottle, recordAuthAttempt } from '../lib/auth-attempts.js';
import { verifyAuthKey } from '../lib/auth-key.js';

const iso = (date) => date.toISOString();

/**
 * Quản lý phiên đăng nhập của CHÍNH MÌNH (ASVS 7.5.2, 16.3.1). Mọi truy vấn đều lọc theo `userId`
 * lấy từ phiên (D16): không có cách nào xem hay hủy phiên của người khác.
 * @param {import('fastify').FastifyInstance} app
 */
export default async function sessionRoutes(app) {
  const auth = { onRequest: app.authenticate };

  app.get(
    '/sessions',
    { ...auth, schema: { response: { 200: SessionListResponse } } },
    async (request) => {
      const { userId, sessionId } = request.auth;
      const sessions = await app.db.session.findMany({
        // Phiên đã hết hạn không còn dùng được, không hiện ra như thể vẫn đang đăng nhập.
        where: { userId, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
          ip: true,
          userAgent: true,
        },
      });
      return sessions.map((s) => ({
        id: s.id,
        current: s.id === sessionId,
        createdAt: iso(s.createdAt),
        lastSeenAt: iso(s.lastSeenAt),
        expiresAt: iso(s.expiresAt),
        ip: s.ip,
        userAgent: s.userAgent,
      }));
    },
  );

  app.post(
    '/sessions/revoke',
    {
      ...auth,
      schema: { body: RevokeSessionsRequest, response: { 200: RevokeSessionsResponse } },
      config: {
        rateLimit: {
          max: RATE_LIMITS.REVOKE_SESSIONS.max,
          timeWindow: RATE_LIMITS.REVOKE_SESSIONS.timeWindowMs,
        },
      },
    },
    async (request, reply) => {
      const { userId, sessionId: currentId } = request.auth;
      const { authKey, sessionId: targetId } = request.body;

      if (targetId === currentId) {
        throw new AppError('VALIDATION_ERROR', 'Dùng đăng xuất để kết thúc phiên hiện tại.');
      }

      // ASVS 7.5.2: cookie phiên là chưa đủ, phải nhập lại mật khẩu. Người mượn được máy đang đăng
      // nhập không đá được chủ tài khoản ra khỏi các thiết bị khác (cùng lý do với D25).
      const user = await app.db.user.findUnique({
        where: { id: userId },
        select: { email: true, authKeyHash: true },
      });
      if (!user) throw new AppError('UNAUTHENTICATED');
      // D81: chung giới hạn theo tài khoản với đăng nhập, và được ghi vào lịch sử (ASVS 16.3.1).
      await enforceAccountThrottle(app.db, reply, user.email);
      const keyMatches = verifyAuthKey(authKey, user.authKeyHash);
      await recordAuthAttempt(app.db, request, {
        userId,
        email: user.email,
        success: keyMatches,
        kind: AUTH_ATTEMPT_KINDS.REVOKE_SESSIONS,
      });
      if (!keyMatches) throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu không đúng.');

      if (targetId) {
        // Điều kiện userId: id phiên của người khác thì không xóa được và nhận NOT_FOUND, y như id
        // không tồn tại (D30).
        const { count } = await app.db.session.deleteMany({ where: { id: targetId, userId } });
        if (count === 0) throw new AppError('NOT_FOUND');
        return { revoked: count };
      }

      const { count } = await app.db.session.deleteMany({
        where: { userId, id: { not: currentId } },
      });
      return { revoked: count };
    },
  );

  app.get(
    '/login-history',
    { ...auth, schema: { response: { 200: LoginHistoryResponse } } },
    async (request) => {
      // Chỉ các lần thử VÀO tài khoản này (userId khớp). Lần thử với email chưa đăng ký có userId
      // null nên không ai xem được, kể cả người sau này đăng ký đúng email đó.
      const rows = await app.db.loginHistory.findMany({
        where: { userId: request.auth.userId },
        orderBy: { createdAt: 'desc' },
        take: LIMITS.LOGIN_HISTORY_LIMIT,
        select: { id: true, success: true, kind: true, createdAt: true, ip: true, userAgent: true },
      });
      return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
    },
  );
}
