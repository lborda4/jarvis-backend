import { randomUUID } from 'node:crypto';

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = { randomUUID } as Crypto;
}
