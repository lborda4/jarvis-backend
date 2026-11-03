import { of, throwError } from 'rxjs';
import { SiigoHttpClient, SiigoHttpError } from './siigo-http.client';
describe('Consulta de existencia de compras por HTTP', () => {
  it('solo convierte un HTTP 404 real en ausencia', async () => {
    const request = jest.fn(() => of({ status: 404, data: { Errors: [{ Code: 'not_found' }] } }));
    const client = new SiigoHttpClient({ request } as never);
    await expect(client.findPurchase('token', 'remote/id', 'partner')).resolves.toBeNull();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: expect.stringContaining('/purchases/remote%2Fid') }));
  });
  it.each([null, {}, { id: 'other-id' }])('rechaza respuestas exitosas incompletas o ajenas al ID solicitado: %s', async data => {
    const client = new SiigoHttpClient({ request: () => of({ status: 200, data }) } as never);
    await expect(client.findPurchase('token', 'remote')).rejects.toThrow('inválida');
  });
  it('retorna la compra cuando el ID consultado existe', async () => {
    const client = new SiigoHttpClient({ request: () => of({ status: 200, data: { id: 'remote' } }) } as never);
    await expect(client.findPurchase('token', 'remote')).resolves.toEqual({ id: 'remote' });
  });
  it.each([400, 401, 403, 500, 503])('no interpreta HTTP %s como eliminado', async status => {
    const client = new SiigoHttpClient({ request: () => of({ status, data: {} }) } as never);
    await expect(client.findPurchase('token', 'remote')).rejects.toBeInstanceOf(SiigoHttpError);
  });
  it('no interpreta timeout o caída de red como eliminado', async () => {
    const client = new SiigoHttpClient({ request: () => throwError(() => new Error('timeout')) } as never);
    await expect(client.findPurchase('token', 'remote')).rejects.toThrow('timeout');
  });
});
