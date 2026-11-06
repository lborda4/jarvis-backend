import { BadRequestException } from '@nestjs/common';

export function normalizeCopyEmails(value: unknown, primaryEmail?: string | null): string[] {
  if (!Array.isArray(value) || value.length > 10 || value.some(email => typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
    throw new BadRequestException('Ingresa hasta 10 correos válidos para copia.');
  }
  return [...new Set(value.map(email => email.trim().toLowerCase()))].filter(email => email !== primaryEmail?.trim().toLowerCase());
}
