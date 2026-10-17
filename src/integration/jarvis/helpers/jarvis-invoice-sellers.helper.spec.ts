import { resolveInvoiceSellers } from './jarvis-invoice-sellers.helper';
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
it('permite facturas sin vendedores sin consultar la base', async () => {
  const query = jest.fn();
  expect(await resolveInvoiceSellers({ query }, 'owner')).toEqual([]);
  expect(await resolveInvoiceSellers({ query }, 'owner', [])).toEqual([]);
  expect(query).not.toHaveBeenCalled();
});
it('conserva orden, evita duplicados y valida la empresa', async () => {
  const query = jest.fn().mockResolvedValue([{ id: second, name: 'Juan' }, { id: first, name: 'Laura' }]);
  expect(await resolveInvoiceSellers({ query }, 'owner', [first, second, first])).toEqual([{ id: first, name: 'Laura' }, { id: second, name: 'Juan' }]);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('company_id=$1'), ['owner', [first, second]]);
});
it('rechaza vendedores ajenos o eliminados', async () => {
  await expect(resolveInvoiceSellers({ query: jest.fn().mockResolvedValue([]) }, 'owner', [first])).rejects.toThrow('no pertenecen');
});
it('rechaza identificadores invalidos sin consultar la base', async () => {
  const query = jest.fn();
  await expect(resolveInvoiceSellers({ query }, 'owner', ['bad-id'])).rejects.toThrow('validos');
  expect(query).not.toHaveBeenCalled();
});