import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

export const REGISTRATION_LINK_ERROR = 'El enlace de registro no es válido, ya se utilizó o venció. Solicita uno nuevo al administrador.';
export function registrationTokenHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new BadRequestException(REGISTRATION_LINK_ERROR);
  return createHash('sha256').update(value).digest('hex');
}
export function newRegistrationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: registrationTokenHash(token) };
}
export function registrationEmail(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    throw new BadRequestException('Ingresa un correo válido para enviar la bienvenida.');
  return value.trim().toLowerCase();
}
