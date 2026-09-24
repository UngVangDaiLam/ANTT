import {
  AppError,
  IdParams,
  NoteCreateRequest,
  NoteListResponse,
  NoteResponse,
  NoteUpdateRequest,
  NoteWriteResponse,
  RotateRequest,
  normalizeEmail,
} from '@secure-notes/shared';

/** Mã lỗi Prisma khi vi phạm ràng buộc unique. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';
/** Mã lỗi Prisma khi `update` không tìm thấy dòng nào khớp điều kiện. */
const PRISMA_RECORD_NOT_FOUND = 'P2025';

const iso = (date) => date.toISOString();

const NOTE_WRITE_SELECT = { id: true, version: true, updatedAt: true };

function writeResult(note) {
  return { id: note.id, version: note.version, updatedAt: iso(note.updatedAt) };
}

/**
 * Route note. Server chỉ thấy ciphertext.
 *
 * Quyền truy cập (D16, D30): chủ note luôn lấy từ PHIÊN, không từ body. Note không thuộc về người
 * gọi thì trả NOT_FOUND, KHÔNG trả FORBIDDEN, để không xác nhận note đó có tồn tại. Mọi truy vấn
 * ghi đều mang `ownerId` trong điều kiện WHERE, nên quyền được kiểm tra cùng lúc với việc ghi
 * chứ không phải "kiểm tra rồi mới ghi" (tránh race).
 * @param {import('fastify').FastifyInstance} app
 */
export default async function noteRoutes(app) {
  const auth = { onRequest: app.authenticate };

  app.post(
    '/notes',
    { ...auth, schema: { body: NoteCreateRequest, response: { 201: NoteWriteResponse } } },
    async (request, reply) => {
      const body = request.body;
      try {
        const note = await app.db.note.create({
          data: {
            id: body.id, // D17: do client sinh vì nằm trong Associated Data
            ownerId: request.auth.userId,
            version: body.version,
            encryptedTitle: body.encryptedTitle,
            encryptedContent: body.encryptedContent,
            wrappedNoteKey: body.wrappedNoteKey,
          },
          select: NOTE_WRITE_SELECT,
        });
        return reply.code(201).send(writeResult(note));
      } catch (err) {
        // Ràng buộc unique của DB là nguồn sự thật duy nhất, không kiểm tra trước (tránh race).
        if (err?.code === PRISMA_UNIQUE_VIOLATION) throw new AppError('NOTE_ID_TAKEN');
        throw err;
      }
    },
  );

  app.get(
    '/notes',
    { ...auth, schema: { response: { 200: NoteListResponse } } },
    async (request) => {
      const notes = await app.db.note.findMany({
        where: { ownerId: request.auth.userId },
        orderBy: { updatedAt: 'desc' },
        // Không lấy encryptedContent: danh sách không được kéo theo nội dung (D21).
        select: {
          id: true,
          version: true,
          encryptedTitle: true,
          wrappedNoteKey: true,
          updatedAt: true,
        },
      });
      return notes.map((note) => ({ ...note, updatedAt: iso(note.updatedAt) }));
    },
  );

  app.get(
    '/notes/:id',
    { ...auth, schema: { params: IdParams, response: { 200: NoteResponse } } },
    async (request) => {
      const { id } = request.params;
      const { userId } = request.auth;

      const note = await app.db.note.findUnique({
        where: { id },
        select: {
          id: true,
          ownerId: true,
          version: true,
          encryptedTitle: true,
          encryptedContent: true,
          wrappedNoteKey: true,
          updatedAt: true,
        },
      });
      if (!note) throw new AppError('NOT_FOUND');

      const common = {
        id: note.id,
        version: note.version,
        encryptedTitle: note.encryptedTitle,
        encryptedContent: note.encryptedContent,
        updatedAt: iso(note.updatedAt),
      };

      if (note.ownerId === userId) {
        return { ...common, wrappedNoteKey: note.wrappedNoteKey };
      }

      // D22: người được chia sẻ đọc chính note gốc, kèm gói chia sẻ của riêng họ. Họ KHÔNG nhận
      // wrappedNoteKey của chủ (bọc bằng Vault Key của chủ, vô dụng với họ và không nên lộ ra).
      const share = await app.db.share.findUnique({
        where: { noteId_recipientId: { noteId: id, recipientId: userId } },
        select: { sharePackage: true, sender: { select: { email: true } } },
      });
      if (!share) throw new AppError('NOT_FOUND');
      return {
        ...common,
        share: { senderEmail: share.sender.email, sharePackage: share.sharePackage },
      };
    },
  );

  app.put(
    '/notes/:id',
    {
      ...auth,
      schema: { params: IdParams, body: NoteUpdateRequest, response: { 200: NoteWriteResponse } },
    },
    async (request) => {
      const { id } = request.params;
      const { userId } = request.auth;
      const body = request.body;
      try {
        // Một câu lệnh duy nhất vừa kiểm tra chủ note, vừa kiểm tra version = hiện tại + 1 (D18),
        // vừa ghi. Hai request cùng sửa một version thì đúng một cái thắng.
        const note = await app.db.note.update({
          where: { id, ownerId: userId, version: body.version - 1 },
          data: {
            version: body.version,
            encryptedTitle: body.encryptedTitle,
            encryptedContent: body.encryptedContent,
          },
          select: NOTE_WRITE_SELECT,
        });
        return writeResult(note);
      } catch (err) {
        if (err?.code !== PRISMA_RECORD_NOT_FOUND) throw err;
        // Không ghi được vì một trong hai lý do; phân biệt để trả đúng mã lỗi.
        const owned = await app.db.note.findFirst({
          where: { id, ownerId: userId },
          select: { id: true },
        });
        throw new AppError(owned ? 'VERSION_CONFLICT' : 'NOT_FOUND');
      }
    },
  );

  app.delete('/notes/:id', { ...auth, schema: { params: IdParams } }, async (request, reply) => {
    // Share của note bị xóa theo (onDelete: Cascade).
    const { count } = await app.db.note.deleteMany({
      where: { id: request.params.id, ownerId: request.auth.userId },
    });
    if (count === 0) throw new AppError('NOT_FOUND');
    return reply.code(204).send();
  });

  app.post(
    '/notes/:id/rotate',
    {
      ...auth,
      schema: { params: IdParams, body: RotateRequest, response: { 200: NoteWriteResponse } },
    },
    async (request) => {
      const { id } = request.params;
      const { userId } = request.auth;
      const body = request.body;

      const emails = body.shares.map((entry) => normalizeEmail(entry.recipientEmail));
      if (new Set(emails).size !== emails.length) {
        throw new AppError('VALIDATION_ERROR', 'Danh sách người nhận có email bị lặp.');
      }

      // Một transaction: hoặc tất cả cùng thành công, hoặc không có gì thay đổi. Nếu ghi xong khóa
      // mới mà chưa kịp xóa share cũ thì người bị thu hồi vẫn còn quyền; nếu xóa share trước mà ghi
      // khóa thất bại thì người còn quyền bị mất quyền oan. Không được để xảy ra nửa vời.
      const note = await app.db.$transaction(async (tx) => {
        let updated;
        try {
          updated = await tx.note.update({
            where: { id, ownerId: userId, version: body.version - 1 },
            data: {
              version: body.version,
              encryptedTitle: body.encryptedTitle,
              encryptedContent: body.encryptedContent,
              wrappedNoteKey: body.wrappedNoteKey,
            },
            select: NOTE_WRITE_SELECT,
          });
        } catch (err) {
          if (err?.code !== PRISMA_RECORD_NOT_FOUND) throw err;
          const owned = await tx.note.findFirst({
            where: { id, ownerId: userId },
            select: { id: true },
          });
          throw new AppError(owned ? 'VERSION_CONFLICT' : 'NOT_FOUND');
        }

        const recipients =
          emails.length === 0
            ? []
            : await tx.user.findMany({
                where: { email: { in: emails } },
                select: { id: true, email: true },
              });
        if (recipients.length !== emails.length) {
          throw new AppError('NOT_FOUND', 'Không tìm thấy một trong những người nhận.');
        }
        if (recipients.some((recipient) => recipient.id === userId)) {
          throw new AppError('VALIDATION_ERROR', 'Không thể chia sẻ cho chính mình.');
        }

        // Người không còn trong danh sách bị thu hồi quyền: xóa gói chia sẻ cũ (chứa khóa CŨ).
        await tx.share.deleteMany({
          where: { noteId: id, recipientId: { notIn: recipients.map((r) => r.id) } },
        });

        const packageByEmail = new Map(
          body.shares.map((entry) => [normalizeEmail(entry.recipientEmail), entry.sharePackage]),
        );
        for (const recipient of recipients) {
          const sharePackage = packageByEmail.get(recipient.email);
          await tx.share.upsert({
            where: { noteId_recipientId: { noteId: id, recipientId: recipient.id } },
            create: { noteId: id, senderId: userId, recipientId: recipient.id, sharePackage },
            update: { senderId: userId, sharePackage },
            select: { id: true },
          });
        }
        return updated;
      });
      return writeResult(note);
    },
  );
}
