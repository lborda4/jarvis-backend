import { Logger } from '@nestjs/common';
import { persistHistorialFacturaFromSendRequest } from './siigo-support-document-preference.helper';
import { HistorialFacturaFuente } from '../../enums/historial-factura-fuente.enum';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';

describe('persistHistorialFacturaFromSendRequest', () => {
  const taxesCatalog: SiigoTaxCatalogItemDto[] = [
    { id: 18900, name: 'IVA 19%', type: 'IVA', percentage: 19, active: true },
    { id: 11811, name: 'Retefuente 1%', type: 'Retefuente', percentage: 1, active: true },
  ];
  const logger = new Logger('test');

  function buildRepositoryMock() {
    return {
      create: jest.fn((data) => data),
      replaceRowsForFacturas: jest.fn(async (..._args: unknown[]) => undefined),
    };
  }

  const electronicDocument = {
    id: 'doc-1',
    payload: {
      supplier: { documentNumber: '900.123.456-7' },
      invoice: { issueDate: '2026-08-10' },
    },
  } as any;

  it('reemplaza (borra+inserta atómico) las filas corregido_contador de este documento', async () => {
    const repository = buildRepositoryMock();

    await persistHistorialFacturaFromSendRequest(
      repository as any,
      {
        documentId: 'doc-1',
        items: [
          {
            code: '519530',
            description: 'Papelería',
            quantity: 1,
            price: 1000,
            taxes: [{ id: 18900 }],
          },
        ],
        payments: [{ id: 5056, value: 1000 }],
        retentions: [{ id: 11811, type: 'Retefuente' }],
        supplierPreferences: {
          paymentMethod: { id: 5056, name: 'Crédito proveedores', type: 'CREDIT' },
        },
      },
      electronicDocument,
      'company-1',
      'integration-1',
      taxesCatalog,
      logger,
    );

    expect(repository.replaceRowsForFacturas).toHaveBeenCalledTimes(1);

    const [companyId, integrationId, facturaIds, savedRows, fuente] = repository
      .replaceRowsForFacturas.mock.calls[0] as [
      string,
      string,
      string[],
      Array<{ [key: string]: unknown; impuestos: Record<string, unknown> }>,
      HistorialFacturaFuente,
    ];

    expect(companyId).toBe('company-1');
    expect(integrationId).toBe('integration-1');
    expect(facturaIds).toEqual(['doc-1']);
    expect(fuente).toBe(HistorialFacturaFuente.CORREGIDO_CONTADOR);

    expect(savedRows).toHaveLength(1);
    expect(savedRows[0]).toMatchObject({
      companyId: 'company-1',
      integrationId: 'integration-1',
      facturaId: 'doc-1',
      proveedorNit: '9001234567',
      cuentaPuc: '519530',
      metodoPagoId: 5056,
      metodoPagoNombre: 'Crédito proveedores',
      fuente: HistorialFacturaFuente.CORREGIDO_CONTADOR,
      fechaFactura: '2026-08-10',
    });
    expect(savedRows[0].impuestos.iva).toEqual({ id: 18900, name: 'IVA 19%', percentage: 19 });
    expect(savedRows[0].impuestos.retefuente).toEqual({
      id: 11811,
      name: 'Retefuente 1%',
      percentage: 1,
    });
  });

  it('si no viene supplierPreferences.paymentMethod, usa el id de payments[0] con un nombre genérico', async () => {
    const repository = buildRepositoryMock();

    await persistHistorialFacturaFromSendRequest(
      repository as any,
      {
        documentId: 'doc-1',
        items: [
          { code: '519530', description: 'Papelería', quantity: 1, price: 1000 },
        ],
        payments: [{ id: 5056, value: 1000 }],
      },
      electronicDocument,
      'company-1',
      'integration-1',
      taxesCatalog,
      logger,
    );

    const [, , , savedRows] = repository.replaceRowsForFacturas.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      Array<{ metodoPagoId: unknown; metodoPagoNombre: unknown }>,
    ];

    expect(savedRows[0].metodoPagoId).toBe(5056);
    expect(savedRows[0].metodoPagoNombre).toBe('Medio 5056');
  });

  it('deja metodoPagoId/metodoPagoNombre en null si no hay ningún medio de pago en el request', async () => {
    const repository = buildRepositoryMock();

    await persistHistorialFacturaFromSendRequest(
      repository as any,
      {
        documentId: 'doc-1',
        items: [
          { code: '519530', description: 'Papelería', quantity: 1, price: 1000 },
        ],
        payments: [],
      },
      electronicDocument,
      'company-1',
      'integration-1',
      taxesCatalog,
      logger,
    );

    const [, , , savedRows] = repository.replaceRowsForFacturas.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      Array<{ metodoPagoId: unknown; metodoPagoNombre: unknown }>,
    ];

    expect(savedRows[0].metodoPagoId).toBeNull();
    expect(savedRows[0].metodoPagoNombre).toBeNull();
  });

  it('no hace nada si no hay ítems en el request', async () => {
    const repository = buildRepositoryMock();

    await persistHistorialFacturaFromSendRequest(
      repository as any,
      { documentId: 'doc-1', items: [], payments: [] },
      electronicDocument,
      'company-1',
      'integration-1',
      taxesCatalog,
      logger,
    );

    expect(repository.replaceRowsForFacturas).not.toHaveBeenCalled();
  });

  it('no hace nada si el proveedor no tiene un NIT resoluble', async () => {
    const repository = buildRepositoryMock();

    await persistHistorialFacturaFromSendRequest(
      repository as any,
      {
        documentId: 'doc-1',
        items: [{ code: '519530', description: 'X', quantity: 1, price: 1 }],
        payments: [],
      },
      {
        ...electronicDocument,
        payload: { ...electronicDocument.payload, supplier: { documentNumber: '' } },
      },
      'company-1',
      'integration-1',
      taxesCatalog,
      logger,
    );

    expect(repository.replaceRowsForFacturas).not.toHaveBeenCalled();
  });
});
