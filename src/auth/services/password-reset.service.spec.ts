import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppConfiguration } from '../../config/configuration';
import { EMAIL_INVALID_MESSAGE } from '../constants/password-reset.constants';
import { User } from '../entities/user.entity';
import { hashResetToken } from '../helpers/password-reset.helper';
import { UsersRepository } from '../repositories/users.repository';
import { PasswordResetService } from './password-reset.service';
import { ResendMailService } from './resend-mail.service';

function config(): ConfigService<AppConfiguration, true> {
  return {
    get: (key: string) => {
      const values: Record<string, string> = {
        'jwt.accessSecret': 'pepper-de-prueba',
        'passwordResetMail.appPublicUrl': 'http://localhost:5173',
      };
      return values[key];
    },
  } as ConfigService<AppConfiguration, true>;
}

describe('PasswordResetService', () => {
  const knownUser = {
    id: 'user-1',
    email: 'ana@empresa.com',
    active: true,
  } as User;

  function setup(emailCount = 0) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('email_count')) {
        return [{ email_count: emailCount, ip_count: 0 }];
      }
      if (sql.includes('RETURNING user_id')) {
        return params[0] === hashResetToken('token-valido')
          ? [[{ user_id: knownUser.id }], 1]
          : [[], 0];
      }
      if (sql.includes('UPDATE users')) {
        return [[{ id: knownUser.id }], 1];
      }
      return [];
    });
    const dataSource = {
      query,
      transaction: jest.fn(async (callback: (manager: { query: typeof query }) => Promise<void>) =>
        callback({ query }),
      ),
    } as unknown as DataSource;
    const usersRepository = {
      findByEmail: jest.fn(async (email: string) =>
        email === knownUser.email ? knownUser : null,
      ),
    } as unknown as UsersRepository;
    const mailer = {
      sendPasswordReset: jest.fn(),
    } as unknown as ResendMailService;

    return {
      queries,
      usersRepository,
      mailer,
      service: new PasswordResetService(
        dataSource,
        config(),
        usersRepository,
        mailer,
      ),
    };
  }

  it('responde igual para un correo registrado y uno que no existe', async () => {
    const { service, mailer, queries } = setup();

    await expect(
      service.requestReset('ana@empresa.com', '10.0.0.1'),
    ).resolves.toBeUndefined();
    await expect(
      service.requestReset('otro@empresa.com', '10.0.0.2'),
    ).resolves.toBeUndefined();

    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
    const resetUrl = (mailer.sendPasswordReset as jest.Mock).mock.calls[0][1] as string;
    const token = new URL(resetUrl).searchParams.get('token') ?? '';
    const insert = queries.find((entry) =>
      entry.sql.includes('INSERT INTO password_reset_tokens'),
    );

    expect(token).not.toHaveLength(0);
    expect(insert?.params).toContain(hashResetToken(token));
    expect(insert?.params).not.toContain(token);
    expect(queries.some((entry) => entry.params.includes('otro@empresa.com'))).toBe(
      false,
    );
  });

  it('no envía correo cuando el correo o la IP superan el límite', async () => {
    const { service, mailer, usersRepository } = setup(5);

    await service.requestReset('ana@empresa.com', '10.0.0.1');

    expect(usersRepository.findByEmail).not.toHaveBeenCalled();
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('no envía correo a una cuenta inactiva', async () => {
    const context = setup();
    knownUser.active = false;

    await context.service.requestReset('ana@empresa.com', '10.0.0.1');

    expect(context.mailer.sendPasswordReset).not.toHaveBeenCalled();
    knownUser.active = true;
  });

  it('rechaza un correo inválido sin consultar usuarios', async () => {
    const { service, usersRepository } = setup();

    await expect(service.requestReset('no-es-correo', '10.0.0.1')).rejects.toThrow(
      EMAIL_INVALID_MESSAGE,
    );
    expect(usersRepository.findByEmail).not.toHaveBeenCalled();
  });

  it('oculta un fallo interno de la solicitud', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, usersRepository } = setup();
    (usersRepository.findByEmail as jest.Mock).mockRejectedValue(
      new Error('ana@empresa.com fallo con re_supersecret'),
    );

    await expect(
      service.requestReset('ana@empresa.com', '10.0.0.1'),
    ).resolves.toBeUndefined();

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('ana@empresa.com');
    expect(logged).not.toContain('re_supersecret');
    warn.mockRestore();
  });

  it('cambia la contraseña solo con un token vigente y no guarda el texto plano', async () => {
    const { service, queries } = setup();

    await service.resetPassword('token-valido', 'clave-nueva');

    const update = queries.find((entry) => entry.sql.includes('UPDATE users'));
    expect(update?.params[0]).not.toBe('clave-nueva');
    expect(String(update?.params[0]).startsWith('$2')).toBe(true);
  });

  it('usa el mismo mensaje para un token inválido', async () => {
    const { service } = setup();

    await expect(service.resetPassword('token-vencido', 'clave-nueva')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.resetPassword('token-vencido', 'clave-nueva')).rejects.toThrow(
      'El enlace no es válido o ya expiró. Solicita uno nuevo.',
    );
  });
});
