import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfiguration } from '../../config/configuration';
import { ResendMailService } from './resend-mail.service';

const API_KEY = 're_supersecret';
const RECIPIENT = 'ana@empresa.com';

function configWith(
  values: Record<string, string | undefined>,
): ConfigService<AppConfiguration, true> {
  return {
    get: (key: string) => values[key],
  } as ConfigService<AppConfiguration, true>;
}

describe('ResendMailService', () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    warn.mockClear();
  });

  afterAll(() => {
    warn.mockRestore();
  });

  it('no registra la API key ni el destinatario cuando Resend rechaza el envío', async () => {
    const text = jest
      .fn()
      .mockResolvedValue(`invalid key ${API_KEY} for ${RECIPIENT}`);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text,
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const service = new ResendMailService(
        configWith({
          'passwordResetMail.apiKey': API_KEY,
          'passwordResetMail.from': 'Jarvis <no-reply@jarviscol.com>',
        }),
      );

      await service.sendPasswordReset(RECIPIENT, 'https://www.jarviscol.com/restablecer-contrasena?token=abc');

      const logged = warn.mock.calls.flat().join(' ');
      expect(logged).toBe('El proveedor de correo rechazó el envío (422).');
      expect(logged).not.toContain(API_KEY);
      expect(logged).not.toContain(RECIPIENT);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = fetchMock.mock.calls[0][1] as RequestInit;
      expect(request.headers).toEqual(
        expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('no llama a Resend si falta la configuración', async () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const service = new ResendMailService(
        configWith({
          'passwordResetMail.apiKey': undefined,
          'passwordResetMail.from': undefined,
        }),
      );

      await service.sendPasswordReset(RECIPIENT, 'https://www.jarviscol.com/restablecer');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(' ')).not.toContain(RECIPIENT);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
