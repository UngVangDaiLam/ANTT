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

/** Mọi lỗi trả về đúng một định dạng { code, message }, không lộ stack trace. */
async function errorsPlugin(app) {
  app.setErrorHandler((error, request, reply) => {
    let appError;
    if (error instanceof AppError) {
      appError = error;
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
