import { JarvisTercerosService } from './jarvis-terceros.service';
import { terceroPaymentMethods } from './helpers/jarvis-tercero-payment-methods.helper';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';
import type { JarvisTercero } from './entities/jarvis-tercero.entity';
const master = [
  { id: 10, name: 'Efectivo', code: '10' },
  { id: 42, name: 'Transferecia Crédito', code: '30' },
  { id: 43, name: 'Tarjeta', code: '48' },
];
function setup() {
  let stored: JarvisTercero | null = null;
  const repository = {
    findByCompanyAndDocument: jest.fn().mockResolvedValue(null),
    findByIdAndCompany: jest.fn((_id: string, company: string) =>
      Promise.resolve(company === 'company-a' ? stored : null),
    ),
    create: jest.fn((data: Partial<JarvisTercero>) => ({
      ...data,
      id: 'tercero',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    save: jest.fn((data: JarvisTercero) => {
      stored = data;
      return Promise.resolve(data);
    }),
  };
  const catalogs = { getPaymentMethods: jest.fn().mockResolvedValue(master) };
  const service = new JarvisTercerosService(
    {
      findByCompanyAndProvider: jest
        .fn()
        .mockResolvedValue({ id: 'integration' }),
    } as never,
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    catalogs as never,
    {} as never,
  );
  return { service, repository, catalogs };
}
const request = {
  document_type: JarvisDocumentType.NIT,
  document_number: '900123456',
  name: 'Cliente',
};
it('homologa las dos opciones con IDs de NextPyme sin confundir 42 con el código DIAN 30', () => {
  expect(terceroPaymentMethods(master)).toEqual([
    { id: 10, code: '10', name: 'Efectivo' },
    { id: 42, code: '30', name: 'Consignación bancaria' },
  ]);
  expect(
    terceroPaymentMethods(master.map((row) => ({ ...row, id: row.id * 10 })))[1]
      .id,
  ).toBe(420);
});
it('no inventa opciones ni usa tarjetas si falta o se duplica la homologación bancaria', () => {
  expect(() => terceroPaymentMethods([master[0], master[2]])).toThrow(
    'Consignación',
  );
  expect(() =>
    terceroPaymentMethods([...master, { ...master[1], id: 420 }]),
  ).toThrow('Consignación');
});
it('consulta el catálogo con la empresa activa y conserva el método al editar', async () => {
  const { service, catalogs } = setup();
  const created = await service.create(
    { ...request, payment_method_id: 42 },
    'company-a',
  );
  expect(created.tercero.payment_method_id).toBe(42);
  expect(catalogs.getPaymentMethods).toHaveBeenCalledWith('company-a');
  const edited = await service.update(
    'tercero',
    { ...request, name: 'Cliente editado' },
    'company-a',
  );
  expect(edited.tercero.payment_method_id).toBe(42);
  expect(
    (
      await service.update(
        'tercero',
        { ...request, payment_method_id: 10 },
        'company-a',
      )
    ).tercero.payment_method_id,
  ).toBe(10);
});
it('mantiene compatibles las importaciones que no incluyen método de pago', async () => {
  const { service, catalogs } = setup();
  expect(
    (await service.create(request, 'company-a')).tercero.payment_method_id,
  ).toBeNull();
  expect(catalogs.getPaymentMethods).not.toHaveBeenCalled();
});
it.each([0, -1, 30, 43, 1.5, '42', null])(
  'rechaza valores inválidos o medios distintos a las dos opciones: %s',
  async (payment_method_id) => {
    const { service, repository } = setup();
    await expect(
      service.create({ ...request, payment_method_id } as never, 'company-a'),
    ).rejects.toThrow(/método|Efectivo/);
    expect(repository.save).not.toHaveBeenCalled();
  },
);
it('propaga un fallo de catálogo y no cambia terceros de otra empresa', async () => {
  const { service, catalogs, repository } = setup();
  catalogs.getPaymentMethods.mockRejectedValueOnce(
    new Error('Catálogo no disponible'),
  );
  await expect(
    service.create({ ...request, payment_method_id: 42 }, 'company-a'),
  ).rejects.toThrow('Catálogo');
  await expect(service.update('tercero', request, 'company-b')).rejects.toThrow(
    'no existe',
  );
  expect(repository.save).not.toHaveBeenCalled();
});
