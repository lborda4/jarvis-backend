import { SiigoSupplierCreationService } from './siigo-supplier-creation.service';
import { SiigoSupplierService } from './siigo-supplier.service';

// Regresión del rechazo real Co|11|1111001. El contrato esperado es fijo:
// corregir producción si falla; no reemplazar 11001 por la salida defectuosa.
function setup(source: 'document' | 'rut' | 'company', city = '1111001') {
  const supplier = {
    documentType: 'NIT', documentNumber: '800165903', checkDigit: '6',
    name: 'PARROQUIA CRISTO RESUCITADO', commercialName: 'PARROQUIA CRISTO RESUCITADO',
    address: 'Calle 45 No. 57 - 47', countryCode: 'Co', stateCode: '11',
    ...(source === 'document' ? { cityCode: city } : {}),
  };
  const document = { id: 'doc-1', companyId: 'company-1', status: 'PENDING',
    payload: { supplier, items: [], taxes: [], totals: { subtotal: 100, iva: 0, total: 100 } } };
  const customer = { id: 'customer-1', name: [supplier.name], identification: '800165903',
    commercial_name: supplier.name, person_type: 'Company', id_type: '31', active: true };
  const http = {
    findCustomerByIdentificationAndBranch: jest.fn().mockResolvedValue(null),
    createCustomer: jest.fn().mockResolvedValue(customer),
  };
  const documents = {
    requireById: jest.fn().mockResolvedValue(document),
    updatePayload: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    updateSupplierExistsInSiigo: jest.fn().mockResolvedValue(undefined),
    findSupplierNotFoundSiblings: jest.fn().mockResolvedValue([]),
  };
  const rut = { lookupDocument: jest.fn().mockResolvedValue(source === 'rut'
    ? { found: true, cityCode: city, stateCode: '11', name: supplier.name }
    : { found: false }) };
  const service = new SiigoSupplierCreationService(
    { getValidAuthContext: jest.fn().mockResolvedValue({ accessToken: 'test-token', partnerId: 'test-partner' }) } as never,
    new SiigoSupplierService(http as never),
    { findByCompanyAndProvider: jest.fn().mockResolvedValue({ id: 'integration-1' }) } as never,
    { findByCompanyIntegrationAndNormalizedSupplierDocument: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value), save: jest.fn(async (value) => value) } as never,
    documents as never,
    {} as never,
    { findById: jest.fn().mockResolvedValue({ cityCode: source === 'company' ? city : '11001' }) } as never,
    rut as never,
  );
  return { service, http, supplier, documents, rut };
}

describe('Regresión: ciudad del tercero enviado a SIIGO', () => {
  it.each(['document', 'rut', 'company'] as const)(
    'envía 11001, no 1111001, cuando el dato viene de %s', async (source) => {
      const { service, http, supplier } = setup(source);
      await service.createSupplier({ documentId: 'doc-1' }, 'company-1');
      expect(http.createCustomer).toHaveBeenCalledTimes(1);
      expect(http.createCustomer).toHaveBeenCalledWith('test-token', expect.objectContaining({
        type: 'Supplier', person_type: 'Company', id_type: '31', identification: '800165903',
        check_digit: '6', name: ['PARROQUIA CRISTO RESUCITADO'],
        address: { address: 'Calle 45 No. 57 - 47',
          city: { country_code: 'Co', state_code: '11', city_code: '11001' } },
      }), 'test-partner');
      if (source === 'document') expect(supplier.cityCode).toBe('1111001');
    },
  );

  it('conserva un código correcto sin volver a agregar el departamento', async () => {
    const { service, http } = setup('document', '11001');
    await service.createSupplier({ documentId: 'doc-1' }, 'company-1');
    expect(http.createCustomer.mock.calls[0][1].address.city).toEqual({
      country_code: 'Co', state_code: '11', city_code: '11001',
    });
  });

  it('prioriza la ciudad que elige el usuario en el modal sobre RUT y documento', async () => {
    const { service, http } = setup('document', '1111001');
    await service.createSupplier(
      { documentId: 'doc-1', city_code: '05001' },
      'company-1',
    );
    expect(http.createCustomer.mock.calls[0][1].address.city).toEqual({
      country_code: 'Co',
      state_code: '05',
      city_code: '05001',
    });
  });

  it('no llama a creación en SIIGO ni marca al proveedor creado con un código inválido', async () => {
    const { service, http, documents } = setup('document', '9911001');
    await expect(service.createSupplier({ documentId: 'doc-1' }, 'company-1')).rejects.toThrow('código DANE');
    expect(http.createCustomer).not.toHaveBeenCalled();
    expect(documents.updateSupplierExistsInSiigo).not.toHaveBeenCalled();
  });

  it('envía al SIIGO la responsabilidad fiscal y el régimen IVA del modal', async () => {
    const { service, http } = setup('document', '11001');
    await service.createSupplier(
      {
        documentId: 'doc-1',
        tax_responsibility: 'O-13',
        vat_responsible: true,
      },
      'company-1',
    );
    expect(http.createCustomer.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        fiscal_responsibilities: [{ code: 'O-13' }],
        vat_responsible: true,
      }),
    );
  });
});
