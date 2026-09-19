/**
 * transportType.js
 * ----------------
 * Chi chua JSDoc typedef cho "Transport" - khong co code chay. Dung de VS Code
 * goi y kieu du lieu khi viet memoryTransport.js/fetchTransport.js moi, hoac
 * khi Tran Bao doc lai de biet chinh xac client se goi ham nao/gui gi/nhan gi.
 *
 * @typedef {object} WrappedKey
 * @property {string} nonce
 * @property {string} ciphertext
 *
 * @typedef {object} Transport
 * @property {(payload: object) => Promise<void>} register
 * @property {(email: string) => Promise<string>} getSalt
 * @property {(args: {email: string, authKeyB64: string}) => Promise<object>} login
 * @property {(payload: object) => Promise<void>} changePassword
 * @property {(email: string) => Promise<{publicKeyB64: string, signingPublicKeyB64: string}>} getUserKeys
 * @property {(payload: object) => Promise<{noteId: string}>} createNote
 * @property {(ownerEmail: string) => Promise<Array<{noteId: string, createdAt: number|string}>>} listNotes
 * @property {(noteId: string) => Promise<object>} getNote
 * @property {(payload: object) => Promise<{shareId: string}>} shareNote
 * @property {(recipientEmail: string) => Promise<Array<object>>} listSharedWithMe
 * @property {(shareId: string) => Promise<object>} getShare
 */

export {};
