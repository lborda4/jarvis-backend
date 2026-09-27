import { Company } from '../../company/entities/company.entity';
import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentStatus } from '../enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';
import type { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';
import { mapElectronicDocumentToPurchaseInvoiceDownload } from './electronic-document-to-purchase-invoice-download.mapper';

function buildCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    nit: '900123456',
    name: 'Compradora S.A.S',
    cityName: 'Bogotá',
    ...overrides,
  } as Company;
}

function buildPayload(
  overrides: Partial<ElectronicDocumentPayload> = {},
): ElectronicDocumentPayload {
  return {
    supplier: {
      documentNumber: '902086460',
      documentType: 'NIT',
      name: 'JARVIS COLOMBIA S.A.S',
      commercialName: 'JARVIS COLOMBIA S.A.S',
      checkDigit: '7',
      address: 'Calle 1 # 2-3',
      phone: '3001234567',
      email: 'proveedor@example.com',
    },
    invoice: {
      cufe: 'cufe-123',
      prefix: 'SETP',
      number: 'SETP990000001',
      issueDate: '2026-07-21',
      dueDate: '2026-08-21',
      isCreditPayment: true,
      currency: 'COP',
    },
    items: [
      {
        descripcion: 'PRODUCTO DE PRUEBA',
        cantidad: 2,
        valorUnitario: 50000,
        total: 100000,
        codigo: 'SKU-1',
        ivaPercentage: 19,
        discount: 0,
      },
    ],
    taxes: [{ type: 'IVA', amount: 19000 }],
    totals: { subtotal: 100000, iva: 19000, total: 119000, discount: 0 },
    observations: 'Nota de la factura',
    withholdings: [{ dianTaxCode: '06', percentage: 2.5 }],
    aiSuggestion: {
      retentions: [],
      confidence: 90,
    },
    accounting: {
      savedAt: '2026-07-21T00:00:00.000Z',
      observations: 'no debe salir',
    },
    ...overrides,
  };
}

function buildDocument(
  overrides: Partial<ElectronicDocument> = {},
): ElectronicDocument {
  return {
    id: 'doc-1',
    companyId: 'company-1',
    cufe: 'cufe-123',
    documentNumberThird: '902086460',
    documentTypeThird: 'NIT',
    status: ElectronicDocumentStatus.PENDING,
    electronicDocumentType: ElectronicDocumentType.PURCHASE_INVOICE,
    payload: buildPayload(),
    draft: {
      savedAt: '2026-07-21T00:00:00.000Z',
      observations: 'borrador SIIGO',
    },
    ...overrides,
  } as ElectronicDocument;
}

describe('mapElectronicDocumentToPurchaseInvoiceDownload', () => {
  it('mapea emisor, comprador, ítems, totales y QR desde el payload certificado', () => {
    const dto = mapElectronicDocumentToPurchaseInvoiceDownload(
      buildDocument(),
      buildCompany(),
    );

    expect(dto.id).toBe('doc-1');
    expect(dto.cufe).toBe('cufe-123');
    expect(dto.invoiceNumber).toBe('SETP990000001');
    expect(dto.prefix).toBe('SETP');
    expect(dto.isCreditPayment).toBe(true);
    expect(dto.issuer).toEqual({
      name: 'JARVIS COLOMBIA S.A.S',
      tradeName: 'JARVIS COLOMBIA S.A.S',
      documentType: 'NIT',
      documentNumber: '902086460',
      checkDigit: '7',
      address: 'Calle 1 # 2-3',
      phone: '3001234567',
      email: 'proveedor@example.com',
      countryName: null,
      departmentName: null,
      cityName: null,
    });
    expect(dto.buyer).toEqual({
      name: 'Compradora S.A.S',
      tradeName: null,
      documentType: 'NIT',
      documentNumber: '900123456',
      checkDigit: null,
      address: null,
      phone: null,
      email: null,
      countryName: null,
      departmentName: null,
      cityName: 'Bogotá',
    });
    expect(dto.items).toEqual([
      {
        description: 'PRODUCTO DE PRUEBA',
        code: 'SKU-1',
        quantity: 2,
        unitValue: 50000,
        discount: null,
        surcharge: null,
        ivaPercentage: 19,
        ivaAmount: 19000,
        total: 100000,
      },
    ]);
    expect(dto.subtotal).toBe(100000);
    expect(dto.iva).toBe(19000);
    expect(dto.discount).toBeNull();
    expect(dto.surcharge).toBeNull();
    expect(dto.paymentMethodName).toBeNull();
    expect(dto.taxes).toEqual([{ type: 'IVA', amount: 19000 }]);
    expect(dto.total).toBe(119000);
    expect(dto.withholdings).toEqual([
      {
        dianTaxCode: '06',
        name: 'ReteFuente',
        percentage: 2.5,
        amount: 2500,
      },
    ]);
    expect(dto.observations).toBe('Nota de la factura');
    expect(dto.dianQrUrl).toContain('documentkey=cufe-123');
    expect(dto.dianQrText).toContain('NumFac: SETP990000001');
    expect(dto.dianQrText).toContain('DocAdq: 900123456');
    expect(dto.dianQrText).not.toContain('HorFac');
    expect(JSON.stringify(dto)).not.toContain('aiSuggestion');
    expect(JSON.stringify(dto)).not.toContain('borrador SIIGO');
  });

  it('convierte campos opcionales vacíos en null y no inventa datos', () => {
    const dto = mapElectronicDocumentToPurchaseInvoiceDownload(
      buildDocument({
        documentNumberThird: null,
        documentTypeThird: null,
        payload: buildPayload({
          supplier: {
            documentNumber: '123',
            documentType: 'NIT',
            name: 'Proveedor',
            address: '  ',
            phone: '',
            email: undefined,
            checkDigit: undefined,
          },
          invoice: {
            cufe: 'cufe-123',
            number: 'FE1',
            issueDate: '2026-01-01',
            currency: 'COP',
          },
          withholdings: [],
          observations: '   ',
        }),
      }),
      buildCompany({ cityName: null }),
    );

    expect(dto.issuer.address).toBeNull();
    expect(dto.issuer.phone).toBeNull();
    expect(dto.issuer.email).toBeNull();
    expect(dto.issuer.checkDigit).toBeNull();
    expect(dto.dueDate).toBeNull();
    expect(dto.isCreditPayment).toBeNull();
    expect(dto.observations).toBeNull();
    expect(dto.buyer.cityName).toBeNull();
    expect(dto.withholdings).toEqual([]);
  });
});
