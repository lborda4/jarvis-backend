import { BadGatewayException } from '@nestjs/common';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { JarvisInvoiceSendService } from './jarvis-invoice-send.service';

function setup(token: string | null = ' company-token ') {
  const queryRunner = {
    connect: jest.fn(), startTransaction: jest.fn(), query: jest.fn(),
    commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(),
  };
  const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
  const companies = { findById: jest.fn().mockResolvedValue({ nextPymeToken: token }) };
  const client = { createSupportDocument: jest.fn().mockResolvedValue({ cuds: "support-code" }), createInvoice: jest.fn().mockResolvedValue({ success: true }) };
  const catalog = {
    getIvaTaxId: () => 1,
    getDefaultUnitMeasureId: () => 70,
    getDefaultItemIdentificationId: () => 4,
    getElectronicInvoiceTypeId: () => 1,
    getSupportDocumentTypeId: () => 11,
    resolveLiabilityId: jest.fn().mockResolvedValue(117),
    resolveCurrencyId: jest.fn().mockResolvedValue(35),
  };
  const numbering = {
    allocateResolutionNumber: jest.fn().mockResolvedValue({ prefix: 'FVJ', number: 1, formNumber: '18764113677438' }),
    commitResolutionNumber: jest.fn(),
  };
  const history = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new JarvisInvoiceSendService(
    dataSource as never,
    { findByCompanyAndProvider: jest.fn().mockResolvedValue({ credentials: { token_nextpyme: 'legacy-token' } }) } as never,
    { findByCompanyAndDocument: jest.fn().mockResolvedValue({ name: 'Cliente', municipalityId: 149, typeRegimeId: 1 }) } as never,
    companies as never, client as never, catalog as never, numbering as never, history as never,
  );
  const request = {
    issueDate: '2026-09-16', customerDocumentType: 'NIT', customerIdentification: '901335977',
    items: [{ description: 'Servicio', quantity: 1, unitValue: 250000, code: '01' }],
  };
  return { service, request, client, companies, numbering, history };
}

describe('JarvisInvoiceSendService token de la empresa', () => {
  it.each([0, 95])('omite campos de documento soporte en ventas con impuesto %s', async (taxAmount) => {
    const { service, request, client } = setup();
    await service.createAndSendInvoice({
      ...request,
      items: [{ description: 'Camisa', quantity: 1, unitValue: 500, code: 'PROD-001', taxAmount }],
    }, 'company-1');

    const line = client.createInvoice.mock.calls[0][0].invoice_lines[0];
    expect(line).not.toHaveProperty('type_generation_transmition_id');
    expect(line).not.toHaveProperty('start_date');
    expect(line.free_of_charge_indicator).toBe(false);
    expect(line.line_extension_amount).toBe('500.00');
    if (taxAmount > 0) {
      expect(line.tax_totals).toEqual([{
        tax_id: 1, tax_amount: '95.00', taxable_amount: '500.00', percent: '19.00',
      }]);
    }
  });

  it('envía con el token guardado en companies y conserva el body de factura', async () => {
    const { service, request, client, companies } = setup();
    await service.createAndSendInvoice(request, 'company-1');
    expect(companies.findById).toHaveBeenCalledWith('company-1');
    expect(client.createInvoice).toHaveBeenCalledWith(expect.objectContaining({
      prefix: 'FVJ', number: 1, type_document_id: 1,
      resolution_number: '18764113677438',
      legal_monetary_totals: expect.objectContaining({ payable_amount: '250000.00' }),
    }), 'company-token');
  });

  it.each([null, '', ' '])('no emite ni asigna numeración cuando falta el token (%s)', async (token) => {
    const { service, request, client, numbering } = setup(token);
    await expect(service.createAndSendInvoice(request, 'company-1')).rejects.toThrow('token de NextPyme');
    expect(client.createInvoice).not.toHaveBeenCalled();
    expect(numbering.allocateResolutionNumber).not.toHaveBeenCalled();
  });
});

describe('Registro del envio en historial', () => {
  it('avanza una vez el consecutivo ocupado y conserva el rechazo sin reenviar ni guardar historial', async () => {
    const { service, request, client, numbering, history } = setup();
    const error = new BadGatewayException('La DIAN rechazó la factura: Regla: 90, Rechazo: Documento procesado anteriormente.');
    client.createInvoice.mockRejectedValue(error);

    await expect(service.createAndSendInvoice(request, 'company-1')).rejects.toBe(error);
    expect(numbering.commitResolutionNumber).toHaveBeenCalledTimes(1);
    expect(numbering.commitResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.ELECTRONIC_INVOICE, 1);
    expect(client.createInvoice).toHaveBeenCalledTimes(1);
    expect(history.record).not.toHaveBeenCalled();
  });

  it('no avanza el consecutivo por otros errores de Nextpyme', async () => {
    const { service, request, client, numbering } = setup();
    client.createInvoice.mockRejectedValue(new BadGatewayException('Regla: ZB01, Fallo en el Schema XML'));
    await expect(service.createAndSendInvoice(request, 'company-1')).rejects.toThrow('ZB01');
    expect(numbering.commitResolutionNumber).not.toHaveBeenCalled();
  });

  it('guarda unicamente despues de la emision aceptada', async () => {
    const { service, request, history } = setup();
    await service.createAndSendInvoice(request, 'company-1');
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1', customerIdentification: '901335977', total: '250000.00', currency: 'COP', prefix: 'FVJ', number: '1',
    }));
  });
  it('no registra como enviada una factura rechazada', async () => {
    const { service, request, client, history } = setup();
    client.createInvoice.mockRejectedValue(new Error('Rechazada'));
    await expect(service.createAndSendInvoice(request, 'company-1')).rejects.toThrow();
    expect(history.record).not.toHaveBeenCalled();
  });
  it('un fallo de historial no altera el exito del envio ni su numeracion', async () => {
    const { service, request, history, numbering } = setup();
    history.record.mockRejectedValue(new Error('Sin conexion'));
    await expect(service.createAndSendInvoice(request, 'company-1')).resolves.toMatchObject({ success: true });
    expect(numbering.commitResolutionNumber).toHaveBeenCalled();
  });
});

describe('Documento soporte con el mismo flujo de ventas', () => {
  it('envia seller y campos de soporte con token, resolucion e historial propios', async () => {
    const { service, request, client, numbering, history } = setup();
    numbering.allocateResolutionNumber.mockResolvedValue({ prefix: 'DSE', number: 1, formNumber: '18764113677438' });
    await service.createAndSendInvoice(request, 'company-1', JarvisResolutionKind.SUPPORT_DOCUMENT);
    expect(client.createInvoice).not.toHaveBeenCalled();
    expect(client.createSupportDocument).toHaveBeenCalledWith(expect.objectContaining({
      type_document_id: 11, prefix: 'DSE', resolution_number: '18764113677438',
      seller: expect.objectContaining({ name: 'Cliente' }),
      invoice_lines: [expect.objectContaining({ type_generation_transmition_id: 1, start_date: request.issueDate })],
    }), 'company-token');
    expect(client.createSupportDocument.mock.calls[0][0]).not.toHaveProperty('customer');
    expect(numbering.allocateResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.SUPPORT_DOCUMENT);
    expect(numbering.commitResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.SUPPORT_DOCUMENT, 1);
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({ documentKind: JarvisResolutionKind.SUPPORT_DOCUMENT, cufe: 'support-code' }));
  });
  it('un rechazo no guarda historial ni avanza el consecutivo', async () => {
    const { service, request, client, numbering, history } = setup();
    client.createSupportDocument.mockRejectedValue(new Error('Rechazado'));
    await expect(service.createAndSendInvoice(request, 'company-1', JarvisResolutionKind.SUPPORT_DOCUMENT)).rejects.toThrow('Rechazado');
    expect(history.record).not.toHaveBeenCalled();
    expect(numbering.commitResolutionNumber).not.toHaveBeenCalled();
  });
});
