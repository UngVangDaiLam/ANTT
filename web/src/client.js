import { SecureNoteClient, createFetchTransport } from '@secure-notes/client-sdk';

const transport = createFetchTransport();
export const client = new SecureNoteClient(transport);
