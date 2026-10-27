import { createHash, createHmac } from 'crypto';
import {
  ATTEMPT_RECORD_MULTIPLIER,
  EMAIL_ATTEMPT_LIMIT,
  IP_ATTEMPT_LIMIT,
} from '../constants/password-reset.constants';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeResetEmail(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

export function isResetEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashRateLimitKey(
  scope: 'email' | 'ip',
  value: string,
  pepper: string,
): string {
  return createHmac('sha256', pepper).update(`${scope}:${value}`).digest('hex');
}

export function isResetAttemptLimited(
  emailCount: number,
  ipCount: number,
): boolean {
  return emailCount >= EMAIL_ATTEMPT_LIMIT || ipCount >= IP_ATTEMPT_LIMIT;
}

export function shouldRecordResetAttempt(count: number, limit: number): boolean {
  return count < limit * ATTEMPT_RECORD_MULTIPLIER;
}

export function isSessionIssuedBeforePasswordChange(
  passwordChangedAt: Date | string | null | undefined,
  issuedAtSeconds: number | undefined,
): boolean {
  if (
    passwordChangedAt == null ||
    issuedAtSeconds == null ||
    !Number.isFinite(issuedAtSeconds)
  ) {
    return false;
  }

  const changedAtMs = new Date(passwordChangedAt).getTime();

  if (!Number.isFinite(changedAtMs)) {
    return false;
  }

  return issuedAtSeconds < Math.floor(changedAtMs / 1000);
}

export function resolveAppPublicOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    if (url.username || url.password) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function isSafeMailFrom(value: string | undefined): value is string {
  if (!value || value.length > 200) {
    return false;
  }

  return !/[\r\n]/.test(value);
}

export function firstQueryRow(
  result: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(result) || result.length === 0) {
    return undefined;
  }

  const rows = Array.isArray(result[0]) ? result[0] : result;
  const row = rows[0];

  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return undefined;
  }

  return row as Record<string, unknown>;
}

export function resolveClientIp(request: { ip?: string }): string {
  const ip = request.ip?.trim();

  if (!ip) {
    return 'unknown';
  }

  return ip.slice(0, 64);
}
