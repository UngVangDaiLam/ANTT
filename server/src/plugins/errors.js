import fp from 'fastify-plugin';
import { AppError } from '@secure-notes/shared';

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
      request.log.error(error);
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
