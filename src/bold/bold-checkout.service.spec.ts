import { of, throwError } from 'rxjs';
import { BOLD_SELLER_EMAIL, BoldCheckoutService } from './bold-checkout.service';
import { BoldHttpClient } from './clients/bold-http.client';
import { matchesExtensionCaja } from './helpers/bold-extension-caja.helper';
import { parseBoldExtensionPayment } from './helpers/bold-extension-payment.helper';

function setup() {
  const registers = {
    findByExtensionCaja: jest.fn().mockResolvedValue([{ companyId: 'company-1', cashRegisterName: 'CAJA 1', boldTerminalId: 'serial-1' }]),
    findByCompanyAndName: jest.fn().mockResolvedValue([{ boldTerminalId: 'serial-1' }]),
  };
  const integrations = { findByCompanyAndProvider: jest.fn().mockResolvedValue({ credentials: { identity_key: ' company-key ' } }) };
  const client = {
    getBindedTerminals: jest.fn().mockResolvedValue({ payload: { available_terminals: [{ terminal_serial: 'serial-1', terminal_model: 'N86', status: 'BINDED' }] } }),
    createCheckout: jest.fn().mockResolvedValue({ payload: { accepted: true }, errors: [] }),
  };
  const service = new BoldCheckoutService(registers as never, integrations as never, client as never);
  const request = { cashRegisterName: ' Principal ', userEmail: 'seller@example.com', amount: { currency: 'COP', taxes: [], tip_amount: 0, total_amount: 10000 } };
  return { service, registers, integrations, client, request };
}

describe('Bold checkout', () => {
  it('recibe el JSON de la extensión y obtiene la empresa de la caja', async () => {
    const { service, registers, client } = setup();
    const result = await service.createFromExtension({ valor: '$15.000,00', caja: 1 });
    expect(registers.findByExtensionCaja).toHaveBeenCalledWith('1');
    expect(registers.findByCompanyAndName).toHaveBeenCalledWith('company-1', 'CAJA 1');
    expect(client.createCheckout).not.toHaveBeenCalled();
    expect(result.payload).toEqual(expect.objectContaining({
      amount: { currency: 'COP', taxes: [], tip_amount: 0, total_amount: 15000 },
      payment_method: 'POS',
      user_email: BOLD_SELLER_EMAIL,
    }));
  });
  it('resuelve caja dentro de la empresa y envía POS con modelo, serial, llave y referencia', async () => {
    const { service, registers, client, request } = setup();
    const result = await service.create('company-1', request);
    expect(registers.findByCompanyAndName).toHaveBeenCalledWith('company-1', 'Principal');
    expect(client.getBindedTerminals).toHaveBeenCalledWith('company-key');
    expect(client.createCheckout).not.toHaveBeenCalled();
    expect(result.payload).toEqual({
      amount: request.amount, user_email: request.userEmail, payment_method: 'POS', terminal_model: 'N86', terminal_serial: 'serial-1', reference: result.reference,
    });
    expect(result.reference).toEqual(expect.any(String));
  });
  it.each([{ matches: [] }, { matches: [{ boldTerminalId: 'a' }, { boldTerminalId: 'b' }] }])('no cobra con caja ausente o ambigua (%j)', async ({ matches }) => {
    const { service, registers, client, request } = setup();
    registers.findByCompanyAndName.mockResolvedValue(matches);
    await expect(service.create('company-1', request)).rejects.toThrow();
    expect(client.createCheckout).not.toHaveBeenCalled();
  });
  it('no cobra en un terminal que ya no está vinculado a la empresa', async () => {
    const { service, client, request } = setup();
    client.getBindedTerminals.mockResolvedValue({ payload: { available_terminals: [] } });
    await expect(service.create('company-1', request)).rejects.toThrow('vinculado');
    expect(client.createCheckout).not.toHaveBeenCalled();
  });
  it.each([0, -1, NaN, Infinity])('rechaza monto inválido %s antes de consultar', async (total) => {
    const { service, registers, request } = setup();
    await expect(service.create('company-1', { ...request, amount: { ...request.amount, total_amount: total } })).rejects.toThrow('monto');
    expect(registers.findByCompanyAndName).not.toHaveBeenCalled();
  });
});

describe('Caja de la extensión', () => {
  const caja1 = { cashRegisterName: 'CAJA 1', cashRegisterId: null };
  it.each(['1', 'CAJA 1', 'caja 1'])('asocia %s con CAJA 1', (caja) => {
    expect(matchesExtensionCaja(caja1, caja)).toBe(true);
  });
  it.each(['2', 'CAJA 2', '10', 'CAJA 10', 'Principal'])('no asocia %s con CAJA 1', (caja) => {
    expect(matchesExtensionCaja(caja1, caja)).toBe(false);
  });
  it('prioriza el id de caja de SIIGO POS', () => {
    expect(matchesExtensionCaja({ cashRegisterName: 'Principal', cashRegisterId: '1' }, '1')).toBe(true);
  });
});

describe('Importes de la extensión', () => {
  it.each([
    ['$15.000,00', 15000], ['$ 1.234.567,89', 1234567.89], ['15000', 15000], [15000, 15000], ['1.500', 1500],
  ])('interpreta %s como %s COP', (valor, total) => {
    expect(parseBoldExtensionPayment({ valor, caja: 1 })).toEqual({ caja: '1', total });
  });
  it.each(['$15,000.00', '15.00', 'abc', '', '-100', '$0,00', null, Infinity])('rechaza %s sin convertirlo a un monto incorrecto', (valor) => {
    expect(() => parseBoldExtensionPayment({ valor, caja: 'caja 1' })).toThrow();
  });
});

describe('Bold HTTP checkout', () => {
  const payload = { amount: { currency: 'COP', taxes: [], tip_amount: 0, total_amount: 10000 }, user_email: 'seller@example.com', payment_method: 'POS' as const, terminal_model: 'N86', terminal_serial: 'serial-1', reference: 'ref-1' };
  it('envía al endpoint de cobro con la llave recibida', async () => {
    const http = { post: jest.fn().mockReturnValue(of({ status: 200, data: { payload: {}, errors: [] } })) };
    const client = new BoldHttpClient(http as never, { get: () => ({ baseUrl: '' }) } as never);
    await client.createCheckout('key', payload);
    expect(http.post).toHaveBeenCalledWith('https://integrations.api.bold.co/payments/app-checkout', payload, expect.objectContaining({ headers: { Authorization: 'x-api-key key' } }));
  });
  it.each([400, 500, 200])('propaga rechazo de Bold (%s)', async (status) => {
    const http = { post: jest.fn().mockReturnValue(of({ status, data: { errors: ['rejected'] } })) };
    const client = new BoldHttpClient(http as never, { get: () => ({ baseUrl: '' }) } as never);
    await expect(client.createCheckout('key', payload)).rejects.toThrow('no aceptó');
  });
  it('no reintenta ni expone credenciales tras un timeout', async () => {
    const http = { post: jest.fn().mockReturnValue(throwError(() => new Error('timeout secret-key'))) };
    const client = new BoldHttpClient(http as never, { get: () => ({ baseUrl: '' }) } as never);
    await expect(client.createCheckout('secret-key', payload)).rejects.toThrow('Verifique el datáfono');
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});
