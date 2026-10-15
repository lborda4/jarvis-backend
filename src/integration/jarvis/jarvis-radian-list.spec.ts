import { JarvisRadianService } from './jarvis-radian.service';

it('restaura facturas y estados guardados por empresa sin llamar a NextPyme', async () => {
  const events = { listInvoices: jest.fn().mockResolvedValue([
    { cufe: 'a'.repeat(96), eventId: 1, status: 'sent', cude: 'cude-1', number: 'FE1', supplier: 'Proveedor', nit: '900001', date: '2026-10-14 10:00:00' },
    { cufe: 'a'.repeat(96), eventId: 3, status: 'processing' },
  ]) };
  const service = new JarvisRadianService({} as never, {} as never, {} as never, events as never);
  const result = await service.listInvoices('owner');
  expect(events.listInvoices).toHaveBeenCalledWith('owner', '');
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ number: 'FE1', supplier: 'Proveedor', date: '2026-10-14', events: [{ eventId: 1, status: 'sent', cude: 'cude-1' }, { eventId: 3, status: 'unknown' }] });
});

it('pagina por factura sin cortar los eventos de la misma factura', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ cufe: index.toString(16).padStart(96, '0'), eventId: 1, status: 'sent' }));
  const events = { listInvoices: jest.fn().mockResolvedValue(rows) };
  const service = new JarvisRadianService({} as never, {} as never, {} as never, events as never);
  const result = await service.listInvoices('owner');
  expect(result.items).toHaveLength(100);
  expect(result.nextCursor).toBe(rows[99].cufe);
  await expect(service.listInvoices('owner', 'invalid')).rejects.toThrow('cursor');
});
