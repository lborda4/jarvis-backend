import { randomUUID } from 'crypto';

export function generateRquid(): string {
  return randomUUID();
}
