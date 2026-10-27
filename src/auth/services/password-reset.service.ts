import { randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { AppConfiguration } from '../../config/configuration';
import {
  EMAIL_ATTEMPT_LIMIT,
  EMAIL_INVALID_MESSAGE,
  IP_ATTEMPT_LIMIT,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  RESET_LINK_INVALID_MESSAGE,
} from '../constants/password-reset.constants';
import { User } from '../entities/user.entity';
import {
  hashRateLimitKey,
  firstQueryRow,
  hashResetToken,
  isResetAttemptLimited,
  isResetEmail,
  normalizeResetEmail,
  resolveAppPublicOrigin,
  shouldRecordResetAttempt,
} from '../helpers/password-reset.helper';
import { UsersRepository } from '../repositories/users.repository';
import { ResendMailService } from './resend-mail.service';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly usersRepository: UsersRepository,
    private readonly resendMailService: ResendMailService,
  ) {}

  async requestReset(email: unknown, ip: string): Promise<void> {
    const normalized = normalizeResetEmail(email);

    if (!isResetEmail(normalized)) {
      throw new BadRequestException(EMAIL_INVALID_MESSAGE);
    }

    try {
      await this.dispatchReset(normalized, ip);
    } catch {
      this.logger.warn('No se pudo completar la solicitud de restablecimiento.');
    }
  }

  async resetPassword(token: unknown, password: unknown): Promise<void> {
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    const normalizedPassword = typeof password === 'string' ? password : '';

    if (
      !normalizedToken ||
      normalizedToken.length > 200 ||
      !/^[A-Za-z0-9_-]+$/.test(normalizedToken)
    ) {
      throw new BadRequestException(RESET_LINK_INVALID_MESSAGE);
    }

    if (normalizedPassword.length < 6) {
      throw new BadRequestException(PASSWORD_TOO_SHORT_MESSAGE);
    }

    if (normalizedPassword.length > 128) {
      throw new BadRequestException(PASSWORD_TOO_LONG_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, BCRYPT_SALT_ROUNDS);
    const tokenHash = hashResetToken(normalizedToken);

    try {
      await this.dataSource.transaction(async (manager) => {
        const consumed = await manager.query(
          `UPDATE password_reset_tokens
           SET used_at = now()
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
           RETURNING user_id`,
          [tokenHash],
        );
        const userId = firstQueryRow(consumed)?.user_id as string | undefined;

        if (!userId) {
          throw new BadRequestException(RESET_LINK_INVALID_MESSAGE);
        }

        const updatedUser = await manager.query(
          `UPDATE users
           SET password = $1, password_changed_at = now(), updated_at = now()
           WHERE id = $2
           RETURNING id`,
          [passwordHash, userId],
        );

        if (!firstQueryRow(updatedUser)?.id) {
          throw new BadRequestException(RESET_LINK_INVALID_MESSAGE);
        }

        await manager.query(
          `UPDATE password_reset_tokens
           SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [userId],
        );
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.warn('No se pudo restablecer la contraseña.');
      throw new InternalServerErrorException(
        'No se pudo restablecer la contraseña. Intenta nuevamente.',
      );
    }
  }

  private async dispatchReset(email: string, ip: string): Promise<void> {
    const limited = await this.consumeRateLimit(email, ip);

    if (limited) {
      return;
    }

    const user = await this.usersRepository.findByEmail(email);

    if (!user?.active) {
      return;
    }

    const token = randomBytes(32).toString('base64url');
    const origin = resolveAppPublicOrigin(
      this.configService.get('passwordResetMail.appPublicUrl', { infer: true }),
    );

    await this.dataSource.query(
      `UPDATE password_reset_tokens
       SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
    await this.dataSource.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '45 minutes')`,
      [randomUUID(), user.id, hashResetToken(token)],
    );

    if (!origin) {
      this.logger.warn(
        'No se envió el correo de restablecimiento porque falta APP_PUBLIC_URL.',
      );
      return;
    }

    await this.resendMailService.sendPasswordReset(
      user.email,
      `${origin}/restablecer-contrasena?token=${encodeURIComponent(token)}`,
    );
  }

  private async consumeRateLimit(email: string, ip: string): Promise<boolean> {
    const pepper = this.configService.get('jwt.accessSecret', { infer: true });
    const emailKey = hashRateLimitKey('email', email, pepper);
    const ipKey = hashRateLimitKey('ip', ip || 'unknown', pepper);
    const counts = await this.dataSource.query(
      `WITH pruned AS (
         DELETE FROM password_reset_attempts
         WHERE created_at < now() - interval '24 hours'
       )
       SELECT
         (SELECT count(*)::int FROM password_reset_attempts
           WHERE key_hash = $1 AND created_at > now() - interval '15 minutes') AS email_count,
         (SELECT count(*)::int FROM password_reset_attempts
           WHERE key_hash = $2 AND created_at > now() - interval '15 minutes') AS ip_count`,
      [emailKey, ipKey],
    );
    const countRow = firstQueryRow(counts);
    const emailCount = Number(countRow?.email_count ?? 0);
    const ipCount = Number(countRow?.ip_count ?? 0);

    if (shouldRecordResetAttempt(emailCount, EMAIL_ATTEMPT_LIMIT)) {
      await this.dataSource.query(
        `INSERT INTO password_reset_attempts (id, key_hash) VALUES ($1, $2)`,
        [randomUUID(), emailKey],
      );
    }

    if (shouldRecordResetAttempt(ipCount, IP_ATTEMPT_LIMIT)) {
      await this.dataSource.query(
        `INSERT INTO password_reset_attempts (id, key_hash) VALUES ($1, $2)`,
        [randomUUID(), ipKey],
      );
    }

    return isResetAttemptLimited(emailCount, ipCount);
  }
}
