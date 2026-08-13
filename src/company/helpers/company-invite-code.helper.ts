import { randomBytes } from 'crypto';

// Sin 0/O/1/I/L para que no se confundan al escribirlo a mano.
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 10;

/**
 * Genera un código de invitación para que nuevos usuarios puedan vincularse
 * a una empresa. 10 caracteres de un alfabeto de 32 símbolos (~50 bits de
 * entropía) — no es adivinable por fuerza bruta como sí lo era el NIT.
 */
export function generateCompanyInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';

  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_CODE_ALPHABET[bytes[i] % INVITE_CODE_ALPHABET.length];
  }

  return code;
}

/**
 * Normaliza un código de invitación digitado por el usuario: quita espacios,
 * guiones u otros separadores y lo pasa a mayúsculas, para comparar contra
 * el valor almacenado sin importar cómo lo haya copiado/pegado.
 */
export function normalizeCompanyInviteCode(value?: string | null): string {
  return (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
