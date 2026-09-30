import { ACCOUNT_THROTTLE, AppError, LIMITS } from '@secure-notes/shared';

/** Cắt User-Agent để header khổng lồ không làm phình bảng Session/LoginHistory. */
export function clientUserAgent(request) {
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, LIMITS.MAX_USER_AGENT_LENGTH) : null;
}

/**
 * Ghi một lần nhập mật khẩu (ASVS 16.3.1): đăng nhập, hoặc nhập lại mật khẩu cho thao tác nhạy cảm.
 * Không ghi authKey, cookie hay bất cứ khóa nào.
 *
 * @param {object} db Prisma client
 * @param {import('fastify').FastifyRequest} request
 * @param {{ userId: string | null, email: string, success: boolean, kind: string }} attempt
 */
export async function recordAuthAttempt(db, request, { userId, email, success, kind }) {
  await db.loginHistory.create({
    data: {
      userId,
      emailAttempted: email,
      success,
      kind,
      ip: request.ip,
      userAgent: clientUserAgent(request),
    },
  });
}

/**
 * Còn phải chờ bao lâu (ms) trước khi được thử mật khẩu của `email` lần nữa; 0 là được thử ngay.
 * Xem ACCOUNT_THROTTLE (D81).
 *
 * Tính theo EMAIL, không theo userId, và chạy y hệt với email chưa đăng ký: nếu chỉ giới hạn tài
 * khoản có thật thì bị chặn hay không lại tiết lộ email nào đã đăng ký (D15).
 *
 * @param {object} db Prisma client
 * @param {string} email đã chuẩn hóa
 * @param {number} [now]
 */
export async function accountThrottleWaitMs(db, email, now = Date.now()) {
  const lastSuccess = await db.loginHistory.findFirst({
    where: { emailAttempted: email, success: true },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const windowStart = now - ACCOUNT_THROTTLE.WINDOW_MS;
  const since = Math.max(windowStart, lastSuccess?.createdAt.getTime() ?? windowStart);

  // Chỉ cần biết số lần sai (tối đa tới mức trần) và lần sai gần nhất.
  const maxRelevant = ACCOUNT_THROTTLE.FREE_FAILURES + 16;
  const failures = await db.loginHistory.findMany({
    where: { emailAttempted: email, success: false, createdAt: { gt: new Date(since) } },
    orderBy: { createdAt: 'desc' },
    take: maxRelevant,
    select: { createdAt: true },
  });

  const excess = failures.length - ACCOUNT_THROTTLE.FREE_FAILURES;
  if (excess < 0) return 0;
  const delay = Math.min(
    ACCOUNT_THROTTLE.BASE_DELAY_MS * 2 ** excess,
    ACCOUNT_THROTTLE.MAX_DELAY_MS,
  );
  return Math.max(0, failures[0].createdAt.getTime() + delay - now);
}

/**
 * Chặn ngay (trước khi kiểm tra mật khẩu) nếu email này đang phải chờ. Trong lúc chờ, lần thử không
 * được kiểm tra nên cũng không được ghi là một lần sai: kẻ tấn công không kéo dài thời gian chờ của
 * chủ tài khoản bằng cách gửi dồn dập.
 *
 * @param {object} db
 * @param {import('fastify').FastifyReply} reply
 * @param {string} email
 */
export async function enforceAccountThrottle(db, reply, email) {
  const waitMs = await accountThrottleWaitMs(db, email);
  if (waitMs <= 0) return;
  const seconds = Math.ceil(waitMs / 1000);
  reply.header('Retry-After', String(seconds));
  const minutes = Math.ceil(seconds / 60);
  throw new AppError(
    'RATE_LIMITED',
    `Nhập sai mật khẩu quá nhiều lần. Hãy thử lại sau khoảng ${minutes} phút.`,
  );
}
