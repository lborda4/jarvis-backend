import { createHash } from 'crypto';
import {
  firstQueryRow,
  hashRateLimitKey,
  hashResetToken,
  isResetAttemptLimited,
  isResetEmail,
  isSafeMailFrom,
  isSessionIssuedBeforePasswordChange,
  normalizeResetEmail,
  resolveAppPublicOrigin,
  shouldRecordResetAttempt,
} from './password-reset.helper';

describe('password-reset.helper', () => {
  it('normaliza el correo y rechaza formatos inválidos', () => {
    expect(normalizeResetEmail('  Ana@Empresa.COM ')).toBe('ana@empresa.com');
    expect(normalizeResetEmail(null)).toBe('');
    expect(isResetEmail('ana@empresa.com')).toBe(true);
    expect(isResetEmail('sin-dominio')).toBe(false);
    expect(isResetEmail(`${'a'.repeat(250)}@empresa.com`)).toBe(false);
  });

  it('guarda un hash del token, no el token', () => {
    const token = 'abc123token';

    expect(hashResetToken(token)).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(hashResetToken(token)).not.toContain(token);
  });

  it('no usa el correo en claro como clave de límite', () => {
    const hash = hashRateLimitKey('email', 'ana@empresa.com', 'pepper');

    expect(hash).not.toContain('ana@empresa.com');
    expect(hashRateLimitKey('email', 'ana@empresa.com', 'otro')).not.toBe(hash);
  });

  it('limita por correo y por IP', () => {
    expect(isResetAttemptLimited(4, 9)).toBe(false);
    expect(isResetAttemptLimited(5, 0)).toBe(true);
    expect(isResetAttemptLimited(0, 10)).toBe(true);
    expect(shouldRecordResetAttempt(19, 5)).toBe(true);
    expect(shouldRecordResetAttempt(20, 5)).toBe(false);
  });

  it('invalida sesiones emitidas antes del cambio de contraseña', () => {
    const changedAt = new Date('2026-10-16T20:00:30.000Z');

    expect(
      isSessionIssuedBeforePasswordChange(
        changedAt,
        Math.floor(changedAt.getTime() / 1000) - 1,
      ),
    ).toBe(true);
    expect(
      isSessionIssuedBeforePasswordChange(
        changedAt,
        Math.floor(changedAt.getTime() / 1000),
      ),
    ).toBe(false);
    expect(isSessionIssuedBeforePasswordChange(null, 10)).toBe(false);
    expect(isSessionIssuedBeforePasswordChange(changedAt, undefined)).toBe(
      false,
    );
  });

  it('lee la fila de un SELECT y de un UPDATE ... RETURNING', () => {
    expect(firstQueryRow([{ user_id: 'user-1' }])?.user_id).toBe('user-1');
    expect(firstQueryRow([[{ user_id: 'user-1' }], 1])?.user_id).toBe('user-1');
    expect(firstQueryRow([[], 0])).toBeUndefined();
  });

  it('acepta solo un origen http(s) sin credenciales', () => {
    expect(resolveAppPublicOrigin('http://localhost:5173/')).toBe(
      'http://localhost:5173',
    );
    expect(resolveAppPublicOrigin('https://www.jarviscol.com/login')).toBe(
      'https://www.jarviscol.com',
    );
    expect(resolveAppPublicOrigin('javascript:alert(1)')).toBeNull();
    expect(resolveAppPublicOrigin('https://user:pass@jarviscol.com')).toBeNull();
    expect(isSafeMailFrom('Jarvis <no-reply@jarviscol.com>')).toBe(true);
    expect(isSafeMailFrom('Jarvis <a@b.com>\nBcc: x@y.com')).toBe(false);
  });
});
