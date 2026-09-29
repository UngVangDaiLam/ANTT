import {
  AppError,
  ChangePasswordRequest,
  EmailParams,
  KDF_DEFAULTS,
  LIMITS,
  LoginRequest,
  RATE_LIMITS,
  RegisterRequest,
  SESSION,
  SaltResponse,
  SelfAccountResponse,
  normalizeEmail,
} from '@secure-notes/shared';
import { toSelfAccount } from '../lib/account.js';
import { hashAuthKey, verifyAuthKey } from '../lib/auth-key.js';
import { fakeSaltFor } from '../lib/fake-salt.js';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from '../lib/session-token.js';

/** Mã lỗi Prisma khi vi phạm ràng buộc unique. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Hash để so sánh khi email không tồn tại, cho cả hai nhánh (có/không có tài khoản) đi qua cùng
 * một phép so sánh hằng thời gian. Không khớp với authKey nào vì authKey thật là SHA-256 của 32 byte.
 */
const DUMMY_AUTH_KEY_HASH = hashAuthKey('A'.repeat(43));

const COOKIE_OPTIONS = Object.freeze({
  path: '/',
  httpOnly: true, // JS trong trang không đọc được cookie, giảm hậu quả của XSS
  secure: true, // bắt buộc với tiền tố __Host-
  sameSite: 'strict', // cùng với kiểm tra Origin ở plugins/security.js để chống CSRF
});

/** Cắt User-Agent để header khổng lồ không làm phình bảng Session/LoginHistory. */
function clientUserAgent(request) {
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, LIMITS.MAX_USER_AGENT_LENGTH) : null;
}

/**
 * Route tài khoản và phiên đăng nhập. Cần `app.db` là Prisma client (hoặc đối tượng giả cùng
 * giao diện khi test) và `app.authenticate` từ plugins/auth.js.
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

  app.get(
    '/users/:email/salt',
    {
      schema: { params: EmailParams, response: { 200: SaltResponse } },
      config: {
        rateLimit: { max: RATE_LIMITS.SALT.max, timeWindow: RATE_LIMITS.SALT.timeWindowMs },
      },
    },
    async (request) => {
      const email = normalizeEmail(request.params.email);
      const user = await app.db.user.findUnique({
        where: { email },
        select: { salt: true, kdfOpslimit: true, kdfMemlimit: true },
      });
      if (user) {
        return {
          salt: user.salt,
          kdfParams: { opslimit: user.kdfOpslimit, memlimit: user.kdfMemlimit },
        };
      }
      // D15: email chưa đăng ký vẫn nhận một salt trông y hệt salt thật, cố định theo email,
      // để không ai dò được email nào đã có tài khoản.
      return {
        salt: fakeSaltFor(email, app.config.serverSecret),
        kdfParams: { ...KDF_DEFAULTS },
      };
    },
  );

  app.post(
    '/login',
    {
      schema: { body: LoginRequest, response: { 200: SelfAccountResponse } },
      config: {
        rateLimit: { max: RATE_LIMITS.LOGIN.max, timeWindow: RATE_LIMITS.LOGIN.timeWindowMs },
      },
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body.email);
      const user = await app.db.user.findUnique({ where: { email } });

      // Luôn chạy phép so sánh, kể cả khi email không tồn tại, để hai trường hợp khó phân biệt
      // qua thời gian phản hồi.
      const authKeyMatches = verifyAuthKey(
        request.body.authKey,
        user ? user.authKeyHash : DUMMY_AUTH_KEY_HASH,
      );
      const success = Boolean(user) && authKeyMatches;

      // Ghi cả lần thất bại (ASVS 16.3.1). Không ghi authKey, cookie hay bất cứ khóa nào.
      await app.db.loginHistory.create({
        data: {
          userId: user ? user.id : null,
          emailAttempted: email,
          success,
          ip: request.ip,
          userAgent: clientUserAgent(request),
        },
      });

      // Cùng một lỗi và cùng một thông điệp cho "không có tài khoản" và "sai mật khẩu".
      if (!success) throw new AppError('INVALID_CREDENTIALS');

      // ASVS 7.2.4: đăng nhập luôn cấp token MỚI và hủy token cũ nếu client đang mang theo.
      const presented = request.cookies[SESSION.COOKIE_NAME];
      if (isWellFormedSessionToken(presented)) {
        await app.db.session.deleteMany({ where: { id: hashSessionToken(presented) } });
      }

      const token = generateSessionToken();
      await app.db.session.create({
        data: {
          id: hashSessionToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + SESSION.TTL_MS),
          ip: request.ip,
          userAgent: clientUserAgent(request),
        },
      });

      reply.setCookie(SESSION.COOKIE_NAME, token, {
        ...COOKIE_OPTIONS,
        maxAge: SESSION.TTL_MS / 1000,
      });
      return toSelfAccount(user);
    },
  );

  app.post('/logout', { onRequest: app.authenticate }, async (request, reply) => {
    // deleteMany: đăng xuất hai lần cùng lúc không được ném lỗi "không tìm thấy".
    await app.db.session.deleteMany({ where: { id: request.auth.sessionId } });
    reply.clearCookie(SESSION.COOKIE_NAME, COOKIE_OPTIONS);
    return reply.code(204).send();
  });

  app.post(
    '/change-password',
    {
      onRequest: app.authenticate,
      schema: { body: ChangePasswordRequest },
      config: {
        rateLimit: {
          max: RATE_LIMITS.CHANGE_PASSWORD.max,
          timeWindow: RATE_LIMITS.CHANGE_PASSWORD.timeWindowMs,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const { userId, sessionId } = request.auth;

      // D25 / ASVS 6.2.3: cookie phiên là chưa đủ, phải chứng minh biết mật khẩu CŨ. Người mượn
      // được máy đang đăng nhập vẫn không đổi được mật khẩu.
      const user = await app.db.user.findUnique({
        where: { id: userId },
        select: { id: true, authKeyHash: true },
      });
      if (!user || !verifyAuthKey(body.oldAuthKey, user.authKeyHash)) {
        throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu cũ không đúng.');
      }

      // Một transaction: đổi thông tin xác thực và hủy các phiên khác phải đi cùng nhau. Nếu chỉ
      // làm được một nửa thì hoặc mật khẩu đã đổi mà phiên của kẻ khác còn sống, hoặc ngược lại.
      await app.db.$transaction(async (tx) => {
        // Điều kiện `authKeyHash` khớp giá trị vừa kiểm tra: hai request đổi mật khẩu đồng thời
        // với cùng oldAuthKey thì chỉ một cái thắng, cái còn lại không ghi đè.
        const { count } = await tx.user.updateMany({
          where: { id: userId, authKeyHash: user.authKeyHash },
          data: {
            salt: body.salt,
            kdfOpslimit: body.kdfParams.opslimit,
            kdfMemlimit: body.kdfParams.memlimit,
            authKeyHash: hashAuthKey(body.authKey), // D14: không lưu authKey gốc
            wrappedVaultKey: body.wrappedVaultKey,
            wrappedX25519PrivateKey: body.wrappedX25519PrivateKey,
            wrappedEd25519PrivateKey: body.wrappedEd25519PrivateKey,
          },
        });
        if (count !== 1) throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu cũ không đúng.');

        // Giữ phiên hiện tại (người dùng vẫn đăng nhập), hủy mọi phiên khác.
        await tx.session.deleteMany({ where: { userId, id: { not: sessionId } } });
      });

      return reply.code(204).send();
    },
  );

  app.get(
    '/me',
    { onRequest: app.authenticate, schema: { response: { 200: SelfAccountResponse } } },
    async (request) => {
      const user = await app.db.user.findUnique({ where: { id: request.auth.userId } });
      // Phiên còn nhưng tài khoản đã biến mất (không lẽ ra xảy ra nhờ onDelete: Cascade):
      // coi như chưa đăng nhập thay vì trả lỗi 500.
      if (!user) throw new AppError('UNAUTHENTICATED');
      return toSelfAccount(user);
    },
  );
}
