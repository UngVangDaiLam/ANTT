import {
  AppError,
  EmailParams,
  IdParams,
  NoteShareListResponse,
  RATE_LIMITS,
  ShareCreateRequest,
  ShareCreatedResponse,
  ShareListResponse,
  UserKeysResponse,
  normalizeEmail,
} from '@secure-notes/shared';

/** Mã lỗi Prisma khi vi phạm ràng buộc khóa ngoại (ví dụ note bị xóa giữa chừng). */
const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';

/**
 * Route chia sẻ và tra khóa công khai. Mọi route đều cần đăng nhập, kể cả tra khóa công khai:
 * nếu để ẩn danh thì bất kỳ ai cũng dò được email nào đã có tài khoản.
 *
 * Người gửi luôn lấy từ PHIÊN, không nhận `senderEmail` từ body (D16).
 * @param {import('fastify').FastifyInstance} app
 */
export default async function shareRoutes(app) {
  const auth = { onRequest: app.authenticate };

  app.get(
    '/users/:email/keys',
    {
      ...auth,
      schema: { params: EmailParams, response: { 200: UserKeysResponse } },
      config: {
        rateLimit: {
          max: RATE_LIMITS.USER_KEYS.max,
          timeWindow: RATE_LIMITS.USER_KEYS.timeWindowMs,
        },
      },
    },
    async (request) => {
      const user = await app.db.user.findUnique({
        where: { email: normalizeEmail(request.params.email) },
        select: { x25519PublicKey: true, ed25519PublicKey: true },
      });
      if (!user) throw new AppError('NOT_FOUND');
      return { x25519PublicKey: user.x25519PublicKey, ed25519PublicKey: user.ed25519PublicKey };
    },
  );

  app.post(
    '/notes/:id/shares',
    {
      ...auth,
      schema: {
        params: IdParams,
        body: ShareCreateRequest,
        response: { 201: ShareCreatedResponse },
      },
    },
    async (request, reply) => {
      const { id: noteId } = request.params;
      const { userId } = request.auth;
      const body = request.body;

      // Chỉ chủ note được chia sẻ. Người khác, kể cả người đang được chia sẻ note đó, nhận
      // NOT_FOUND y như note không tồn tại (D30).
      const note = await app.db.note.findFirst({
        where: { id: noteId, ownerId: userId },
        select: { id: true },
      });
      if (!note) throw new AppError('NOT_FOUND');

      const recipient = await app.db.user.findUnique({
        where: { email: normalizeEmail(body.recipientEmail) },
        select: { id: true },
      });
      if (!recipient) throw new AppError('NOT_FOUND', 'Không tìm thấy người nhận.');
      if (recipient.id === userId) {
        throw new AppError('VALIDATION_ERROR', 'Không thể chia sẻ cho chính mình.');
      }

      try {
        // Chia sẻ lại cho cùng một người là THAY gói cũ, không tạo bản ghi mới
        // (@@unique([noteId, recipientId])).
        const share = await app.db.share.upsert({
          where: { noteId_recipientId: { noteId, recipientId: recipient.id } },
          create: {
            noteId,
            senderId: userId,
            recipientId: recipient.id,
            sharePackage: body.sharePackage,
          },
          update: { senderId: userId, sharePackage: body.sharePackage },
          select: { id: true },
        });
        return reply.code(201).send({ id: share.id });
      } catch (err) {
        // Note bị xóa ngay giữa lúc kiểm tra và lúc ghi.
        if (err?.code === PRISMA_FOREIGN_KEY_VIOLATION) throw new AppError('NOT_FOUND');
        throw err;
      }
    },
  );

  app.get(
    '/notes/:id/shares',
    { ...auth, schema: { params: IdParams, response: { 200: NoteShareListResponse } } },
    async (request) => {
      const { id: noteId } = request.params;
      // Chỉ chủ note. Người khác, kể cả người đang được chia sẻ note này, nhận NOT_FOUND y như note
      // không tồn tại (D30): họ không được biết note còn được chia sẻ cho những ai khác.
      const note = await app.db.note.findFirst({
        where: { id: noteId, ownerId: request.auth.userId },
        select: { id: true },
      });
      if (!note) throw new AppError('NOT_FOUND');

      const shares = await app.db.share.findMany({
        where: { noteId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, recipient: { select: { email: true } } },
      });
      return shares.map((share) => ({
        id: share.id,
        recipientEmail: share.recipient.email,
        createdAt: share.createdAt.toISOString(),
      }));
    },
  );

  app.get(
    '/shares',
    { ...auth, schema: { response: { 200: ShareListResponse } } },
    async (request) => {
      // Người nhận lấy từ phiên. Chỉ trả tham chiếu (noteId), không trả sharePackage hay ciphertext:
      // nội dung đọc qua GET /api/notes/:id.
      const shares = await app.db.share.findMany({
        where: { recipientId: request.auth.userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          noteId: true,
          createdAt: true,
          sender: { select: { email: true } },
        },
      });
      return shares.map((share) => ({
        id: share.id,
        noteId: share.noteId,
        senderEmail: share.sender.email,
        createdAt: share.createdAt.toISOString(),
      }));
    },
  );

  app.delete('/shares/:id', { ...auth, schema: { params: IdParams } }, async (request, reply) => {
    // Chỉ người gửi được xóa. Người khác (kể cả người nhận) nhận NOT_FOUND.
    //
    // LƯU Ý: xóa gói chia sẻ chỉ chặn lần đọc sau qua API, KHÔNG thu hồi được khóa mà người nhận
    // đã giải mã và có thể đã giữ lại. Muốn thu hồi thật sự phải xoay khóa note (D24).
    const { count } = await app.db.share.deleteMany({
      where: { id: request.params.id, senderId: request.auth.userId },
    });
    if (count === 0) throw new AppError('NOT_FOUND');
    return reply.code(204).send();
  });
}
