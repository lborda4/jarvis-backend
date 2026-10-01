import { SiigoAccountMappingService } from './siigo-account-mapping.service';

describe('Preparación de cuentas importadas en documento soporte', () => {
  it('no sustituye las cuentas del Excel por reglas históricas ni agrupa ítems con igual descripción', async () => {
    const payload = { supplier: { documentNumber: '12345678', documentType: 'CC' }, items: [
      { descripcion: 'Servicio', cantidad: 1, valorUnitario: 100, total: 100, accountMapping: { code: '61601013', description: 'Valoraciones' } },
      { descripcion: 'Servicio', cantidad: 1, valorUnitario: 100, total: 100, accountMapping: { code: '513595', description: 'Servicios' } },
    ] };
    const doc = { id: 'd', companyId: 'c', electronicDocumentType: 'SUPPORT_DOCUMENT', payload, createdAt: new Date(), updatedAt: new Date() };
    const documents = { requireById: jest.fn().mockResolvedValue(doc), updatePayloadAndStatus: jest.fn().mockImplementation(async (_id, value) => ({ ...doc, payload: value })) };
    const rules = { findOneByKey: jest.fn() };
    const service = new SiigoAccountMappingService(
      { findByCompanyIntegrationAndSupplierIdentity: jest.fn().mockResolvedValue(null) } as never,
      rules as never, {} as never, documents as never,
      { findByCompanyAndProvider: jest.fn().mockResolvedValue({ id: 'i' }) } as never,
    );
    const result = await service.validateAccountMapping({ documentId: 'd' }, 'c');
    expect(rules.findOneByKey).not.toHaveBeenCalled();
    expect(documents.updatePayloadAndStatus.mock.calls[0][1].items.map((item: any) => item.accountMapping.code)).toEqual(['61601013', '513595']);
    expect(result.accountCode).toBeUndefined();
  });
});
