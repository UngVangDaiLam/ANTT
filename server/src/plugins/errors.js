import fp from 'fastify-plugin';
import { AppError } from '@secure-notes/shared';

/**
 * Lỗi của Prisma nhận diện được qua `clientVersion` (mọi lớp lỗi của Prisma đều có) hoặc tên lớp.
 */
function isPrismaError(error) {
  return typeof error?.clientVersion === 'string' || /^PrismaClient/.test(error?.name ?? '');
}

/**
 * Bản an toàn để ghi log. Message (và cả stack, vốn bắt đầu bằng message) của lỗi validation của
 * Prisma in NGUYÊN đối tượng tham số của câu truy vấn, tức là ciphertext, khóa đã bọc, authKeyHash...
 * `errorFormat: 'minimal'` KHÔNG che được phần này (đã kiểm chứng). Vì vậy với lỗi Prisma chỉ ghi
 * tên lớp và mã lỗi; `meta` bị bỏ qua vì với một số mã lỗi nó chứa giá trị của cột.
 */
function loggableError(error) {
  if (isPrismaError(error)) {
    return { type: error.name, code: error.code, clientVersion: error.clientVersion };
  }
  return error;
}

/**
 * Mã lỗi là sự kiện bảo mật đáng ghi lại (ASVS 16.3.2): bị từ chối quyền, chưa đăng nhập, sai mật
 * khẩu, bị giới hạn tần suất. NOT_FOUND nằm ở đây vì truy cập note của người khác trả NOT_FOUND (D30).
 */
const SECURITY_EVENT_CODES = new Set([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
]);

/**
 * Ghi mẫu route (`/api/notes/:id`) chứ không ghi URL thật. Không ghi header, cookie hay body (nơi có
 * email, D85).
 */
function logSecurityEvent(request, code) {
  request.log.warn(
    {
      event: 'access_denied',
      code,
      userId: request.auth?.userId ?? null,
      method: request.method,
      route: request.routeOptions?.url ?? null,
      ip: request.ip,
    },
    'Từ chối yêu cầu',
  );
}

/** Mọi lỗi trả về đúng một định dạng { code, message }, không lộ stack trace. */
async function errorsPlugin(app) {
  app.setErrorHandler((error, request, reply) => {
    let appError;
    if (error instanceof AppError) {
      appError = error;
      if (SECURITY_EVENT_CODES.has(appError.code)) logSecurityEvent(request, appError.code);
    } else if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      appError = new AppError('PAYLOAD_TOO_LARGE');
    } else if (error.validation || (error.statusCode >= 400 && error.statusCode < 500)) {
      // Sai schema, JSON hỏng, JSON chứa __proto__... đều là dữ liệu không hợp lệ.
      appError = new AppError('VALIDATION_ERROR');
    } else {
      // CLAUDE.md: không log authKey, cookie, khóa hay ciphertext — kể cả qua message của lỗi.
      request.log.error({ err: loggableError(error) }, 'Lỗi không mong đợi');
      appError = new AppError('INTERNAL_ERROR');
    }
    reply.code(appError.statusCode).send(appError.toJSON());
  });

  app.setNotFoundHandler((request, reply) => {
    const err = new AppError('NOT_FOUND');
    reply.code(err.statusCode).send(err.toJSON());
  });
}

export default fp(errorsPlugin, { name: 'errors' });
