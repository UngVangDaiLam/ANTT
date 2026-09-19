/**
 * schemas.js (package @secure-note/client-sdk)
 * ----------------------------------------------
 * Schema TypeBox de kiem tra hinh dang response tu server THAT (fetchTransport.js)
 * truoc khi dua vao logic crypto. Dung Value.Check thay vi ajv vi Value.Check
 * khong sinh code bang new Function() luc runtime -> khong vi pham CSP (ajv mac
 * dinh can 'unsafe-eval' khi compile schema thanh ham).
 *
 * Day la phong thu chong "server doc hai": neu server (hoac ke tan cong xen giua)
 * tra ve JSON thieu truong, sai kieu, hoac co truong la nhu __proto__, cac ham
 * trong fetchTransport.js se tu choi ngay o day thay vi de loi mo ho xuat hien
 * sau, sau trong logic giai ma.
 */

import { Type } from '@sinclair/typebox';

/** {nonce, ciphertext} dang base64 - dung cho moi gia tri da duoc AEAD boc lai. */
export const WrappedKeySchema = Type.Object(
  {
    nonce: Type.String(),
    ciphertext: Type.String(),
  },
  { additionalProperties: false }
);

export const RegisterResponseSchema = Type.Object({}, { additionalProperties: true });

export const GetSaltResponseSchema = Type.Object(
  {
    saltB64: Type.String(),
  },
  { additionalProperties: true }
);

export const LoginResponseSchema = Type.Object(
  {
    email: Type.String(),
    wrappedVaultKey: WrappedKeySchema,
    publicKeyB64: Type.String(),
    wrappedPrivateKey: WrappedKeySchema,
    signingPublicKeyB64: Type.String(),
    wrappedSigningPrivateKey: WrappedKeySchema,
  },
  { additionalProperties: true }
);

export const UserKeysResponseSchema = Type.Object(
  {
    publicKeyB64: Type.String(),
    signingPublicKeyB64: Type.String(),
  },
  { additionalProperties: true }
);

export const CreateNoteResponseSchema = Type.Object(
  {
    noteId: Type.String(),
  },
  { additionalProperties: true }
);

export const NoteListItemSchema = Type.Object(
  {
    noteId: Type.String(),
    createdAt: Type.Union([Type.Number(), Type.String()]),
  },
  { additionalProperties: true }
);
export const NoteListResponseSchema = Type.Array(NoteListItemSchema);

export const NoteRecordSchema = Type.Object(
  {
    noteId: Type.String(),
    ownerEmail: Type.String(),
    nonce: Type.String(),
    ciphertext: Type.String(),
    wrappedNoteKeyForOwner: WrappedKeySchema,
  },
  { additionalProperties: true }
);

export const ShareResponseSchema = Type.Object(
  {
    shareId: Type.String(),
  },
  { additionalProperties: true }
);

export const SharedWithMeItemSchema = Type.Object(
  {
    shareId: Type.String(),
    noteId: Type.String(),
    senderEmail: Type.String(),
    createdAt: Type.Union([Type.Number(), Type.String()]),
  },
  { additionalProperties: true }
);
export const SharedWithMeResponseSchema = Type.Array(SharedWithMeItemSchema);

export const ShareRecordSchema = Type.Object(
  {
    shareId: Type.String(),
    noteId: Type.String(),
    senderEmail: Type.String(),
    recipientEmail: Type.String(),
    ephemeralPublicKey: Type.String(),
    nonce: Type.String(),
    ciphertext: Type.String(),
    signature: Type.String(),
    noteNonce: Type.String(),
    noteCiphertext: Type.String(),
  },
  { additionalProperties: true }
);
