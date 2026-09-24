import fp from 'fastify-plugin';
import { AppError, SESSION } from '@secure-notes/shared';
import { hashSessionToken, isWellFormedSessionToken } from '../lib/session-token.js';

/**
 * Xác thực bằng cookie phiên. Danh tính của người gọi CHỈ lấy từ đây (D16), không bao giờ từ
 * body, query hay URL do client gửi.
 *
 * Dùng: `{ onRequest: app.authenticate }`, sau đó đọc `request.auth.userId`.
 *
 * Gắn ở `onRequest` chứ KHÔNG phải `preHandler`: Fastify parse và validate body trước `preHandler`,
 * nên người chưa đăng nhập vẫn bắt được server đọc tới 1 MB body và chạy validate. `onRequest` chạy
 * trước cả hai, request chưa xác thực bị chặn ngay từ đầu.
 */
async function authPlugin(app) {
  app.decorateRequest('auth', null);

  app.decorate('authenticate', async function authenticate(request) {
    const token = request.cookies[SESSION.COOKIE_NAME];
    // Cookie sai hình dạng thì khỏi tốn một truy vấn DB.
    if (!isWellFormedSessionToken(token)) throw new AppError('UNAUTHENTICATED');

    const sessionId = hashSessionToken(token);
    const session = await app.db.session.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, expiresAt: true, lastSeenAt: true },
    });
    if (!session) throw new AppError('UNAUTHENTICATED');

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      // Dọn luôn phiên hết hạn (deleteMany để không lỗi nếu request khác đã xóa trước).
      await app.db.session.deleteMany({ where: { id: sessionId } });
      throw new AppError('UNAUTHENTICATED');
    }

    if (now - session.lastSeenAt.getTime() > SESSION.TOUCH_INTERVAL_MS) {
      // updateMany chứ không phải update: nếu phiên vừa bị xóa (đăng xuất ở tab khác) ngay giữa lúc
      // đọc và lúc ghi, update sẽ ném P2025 thành lỗi 500. Không cập nhật được dòng nào nghĩa là phiên
      // đã không còn, nên từ chối như mọi phiên không hợp lệ khác.
      const { count } = await app.db.session.updateMany({
        where: { id: sessionId },
        data: { lastSeenAt: new Date(now) },
      });
      if (count === 0) throw new AppError('UNAUTHENTICATED');
    }

    request.auth = { sessionId, userId: session.userId };
  });
}

export default fp(authPlugin, { name: 'auth' });
