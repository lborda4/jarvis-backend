import { captureIssuedSnapshot, issuedItemName } from './jarvis-issued-snapshot.helper';

it('conserva las partes y nombres originales tras modificar productos, tercero y emisor', async () => {
  const products = [{ sku: 'P1', name: 'Producto original' }];
  const source = { query: jest.fn().mockResolvedValue(products) };
  const credentials = { business_name: 'Emisor original', address: 'Dirección original', economic_activity: '4923', token_nextpyme: 'secret' };
  const buyer = { name: 'Cliente original', address: 'Dirección cliente', email: 'original@example.com' };
  const items = [{ code: 'P1', description: 'Descripción enviada', quantity: 1, unitValue: 100 }];
  const snapshot = await captureIssuedSnapshot(source as never, { companyId: 'owner', company: { nit: '123', name: 'Empresa' }, credentials, buyer, items });
  products[0].name = 'Producto nuevo'; credentials.business_name = 'Emisor nuevo'; buyer.name = 'Cliente nuevo'; items[0].description = 'Descripción nueva';
  expect(snapshot.issuer.name).toBe('Emisor original');
  expect(snapshot.buyer).toMatchObject({ name: 'Cliente original', address: 'Dirección cliente', email: 'original@example.com' });
  expect(snapshot.items[0]).toEqual({ code: 'P1', description: 'Descripción enviada', name: 'Producto original' });
  expect(source.query).toHaveBeenCalledWith(expect.stringContaining('WHERE company_id=$1 AND sku=ANY($2::text[])'), ['owner', ['P1']]);
  expect(JSON.stringify(snapshot)).not.toContain('secret');
  expect(issuedItemName(snapshot, 0, { code: 'P1', description: 'Descripción enviada' })).toBe('Producto original');
  expect(issuedItemName(snapshot, 0, { code: 'OTRO', description: 'Otra línea' })).toBeUndefined();
  expect(issuedItemName(snapshot, 0, { code: 'OTRO', description: 'Descripción enviada' })).toBeUndefined();
});
it('guarda la descripción enviada si no existe un nombre de catálogo y no inventa nombres antiguos', async () => {
  const snapshot = await captureIssuedSnapshot({ query: jest.fn() } as never, { companyId: 'owner', company: { nit: '123', name: 'Empresa' }, credentials: {}, buyer: {}, items: [{ description: 'Servicio manual', quantity: 1, unitValue: 100 }] });
  expect(snapshot.items[0].name).toBe('Servicio manual');
  expect(issuedItemName(undefined, 0, { description: 'Servicio manual' })).toBeUndefined();
});
