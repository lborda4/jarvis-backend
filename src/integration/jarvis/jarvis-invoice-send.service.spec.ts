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
  const client = { createDebitNote: jest.fn().mockResolvedValue({ cude: 'debit-code' }), createCreditNote: jest.fn().mockResolvedValue({ cude: 'credit-code' }), createSupportDocument: jest.fn().mockResolvedValue({ cuds: "support-code" }), createInvoice: jest.fn().mockResolvedValue({ success: true }) };
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
  it.each([JarvisResolutionKind.ELECTRONIC_INVOICE, JarvisResolutionKind.SUPPORT_DOCUMENT])('calcula retenciones por ítem y ReteICA por mil (%s)', async (kind) => {
    const { service, request, client } = setup();
    await service.createAndSendInvoice({ ...request, items: [
      { description: 'Servicio', quantity: 1, unitValue: 100000, taxAmount: 19000, retention: { id: 6, type: 'Retefuente', percentage: 4 } },
      { description: 'Otro servicio', quantity: 1, unitValue: 200000, taxAmount: 38000, retention: { id: 6, type: 'Retefuente', percentage: 6 } },
      { description: 'ReteIVA', quantity: 1, unitValue: 100000, taxAmount: 19000, retention: { id: 5, type: 'ReteIVA', percentage: 15 } },
    ], retentions: [{ id: 7, type: 'ReteICA', percentage: 4.14 }] }, 'company-1', kind);
    const mock = kind === JarvisResolutionKind.SUPPORT_DOCUMENT ? client.createSupportDocument : client.createInvoice;
    const body = mock.mock.calls[0][0];
    expect(body.with_holding_tax_total).toEqual(expect.arrayContaining([
      { tax_id: 6, tax_amount: '4000.00', taxable_amount: '100000.00', percent: '4' },
      { tax_id: 6, tax_amount: '12000.00', taxable_amount: '200000.00', percent: '6' },
      { tax_id: 5, tax_amount: '2850.00', taxable_amount: '19000.00', percent: '15' },
      { tax_id: 7, tax_amount: '1656.00', taxable_amount: '400000.00', percent: '0.414' },
    ]));
    expect(body.tax_totals.every((tax: any) => tax.tax_id === 1)).toBe(true);
  });

  it.each([JarvisResolutionKind.ELECTRONIC_INVOICE, JarvisResolutionKind.SUPPORT_DOCUMENT])('avanza una vez el consecutivo ocupado y conserva el rechazo sin reenviar ni guardar historial (%s)', async (kind) => {
    const { service, request, client, numbering, history } = setup();
    const error = new BadGatewayException('La DIAN rechazó la factura: Regla: 90, Rechazo: Documento procesado anteriormente.');
    const send = kind === JarvisResolutionKind.SUPPORT_DOCUMENT ? client.createSupportDocument : client.createInvoice;
    send.mockRejectedValue(error);

    await expect(service.createAndSendInvoice(request, 'company-1', kind)).rejects.toBe(error);
    expect(numbering.commitResolutionNumber).toHaveBeenCalledTimes(1);
    expect(numbering.commitResolutionNumber).toHaveBeenCalledWith('company-1', kind, 1);
    expect(send).toHaveBeenCalledTimes(1);
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

describe('Notas credito Jarvis', () => {
  const reference = { number: 'SETP990000605', uuid: 'a'.repeat(96), issueDate: '2026-09-15' };
  it('envia referencia, motivo y lineas al servicio correcto y usa numeracion independiente', async () => {
    const {service, request, client, numbering, history} = setup();
    await service.createAndSendInvoice({ ...request, billingReference: reference,
      discrepancyResponseCode: 2, discrepancyResponseDescription: 'Devolucion', seze: '2026', sendmail: true,
      items: [{ description: 'Servicio', quantity: 2, unitValue: 100, discount: 20, taxAmount: 34.2, notes: 'Detalle' }],
      payment: { id: 10 },
    }, 'company-1', JarvisResolutionKind.CREDIT_NOTE);
    expect(client.createInvoice).not.toHaveBeenCalled();
    expect(client.createSupportDocument).not.toHaveBeenCalled();
    const payload = client.createCreditNote.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({ type_document_id: 4,
      billing_reference: { number: reference.number, uuid: reference.uuid, issue_date: reference.issueDate },
      discrepancyresponsecode: 2, discrepancyresponsedescription: 'Devolucion', sendmail: true, seze: '2026',
      legal_monetary_totals: expect.objectContaining({ payable_amount: '214.20' }),
    }));
    expect(payload).not.toHaveProperty('invoice_lines');
    expect(payload).not.toHaveProperty('seller');
    expect(payload).not.toHaveProperty('payment_form');
    expect(payload.credit_note_lines[0]).toEqual(expect.objectContaining({ notes: 'Detalle', line_extension_amount: '180.00', allowance_charges: [expect.objectContaining({amount: '20.00'})] }));
    expect(numbering.allocateResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.CREDIT_NOTE);
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-1', documentKind: JarvisResolutionKind.CREDIT_NOTE, cufe: 'credit-code' }));
  });
  it.each([undefined, { ...reference, uuid: 'invalid' }, { ...reference, issueDate: '2026-10-01' }])('rechaza referencia invalida antes de asignar consecutivo', async billingReference => {
    const {service, request, numbering} = setup();
    await expect(service.createAndSendInvoice({ ...request, billingReference, discrepancyResponseCode: 2, discrepancyResponseDescription: 'Motivo' }, 'company-1', JarvisResolutionKind.CREDIT_NOTE)).rejects.toThrow('factura afectada');
    expect(numbering.allocateResolutionNumber).not.toHaveBeenCalled();
  });
  it('no registra ni avanza una nota rechazada', async () => {
    const { service, request, client, numbering, history } = setup();
    client.createCreditNote.mockRejectedValue(new BadGatewayException('Rechazada'));
    await expect(service.createAndSendInvoice({ ...request, billingReference: reference, discrepancyResponseCode: 2, discrepancyResponseDescription: 'Motivo' }, 'company-1', JarvisResolutionKind.CREDIT_NOTE)).rejects.toThrow('Rechazada');
    expect(history.record).not.toHaveBeenCalled();
    expect(numbering.commitResolutionNumber).not.toHaveBeenCalled();
  });
});

describe('invoice source persistence', () => {
  it('records the full accepted request independently of later edits', async () => {
    const { service, request, history } = setup();
    await service.createAndSendInvoice(request, 'company-1');
    const saved = history.record.mock.calls[0][0].sourceRequest;
    expect(saved).toEqual(request);
    request.items[0].description = 'Changed';
    expect(saved.items[0].description).toBe('Servicio');
  });
});

describe('invoice viewer after issuance', () => {
  it('returns the history ID and stores the XML supplied on successful issuance', async () => {
    const { service, client, history, request } = setup();
    history.record.mockResolvedValue('history-id' as never);
    client.createInvoice.mockResolvedValue({ success: true, xml: Buffer.from('<Invoice/>').toString('base64') } as never);
    const result = await service.createAndSendInvoice(request, 'company');
    expect(result.invoice.historyId).toBe('history-id');
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({ invoiceXml: '<Invoice/>' }));
  });
});

describe('Notas debito Jarvis', () => {
  const reference = { number: 'FV100', uuid: 'a'.repeat(96), issueDate: '2026-09-01' };
  it('uses debit fields, preserves copied line values and allocates independent numbering', async () => {
    const { service, request, client, history, numbering } = setup();
    await service.createAndSendInvoice({ ...request, billingReference: reference,
      discrepancyResponseCode: 3, discrepancyResponseDescription: 'Ajuste de valor', observations: 'Observaciones',
      headNote: 'Encabezado', footNote: 'Pie', sendmail: true, seze: 'REF', discountAmount: 10,
      items: [{ description: 'Producto', code: 'ABC', notes: 'Detalle', quantity: 2, unitValue: 100, discount: 20, taxAmount: 34.2, taxId: 1 }],
    }, 'company-1', JarvisResolutionKind.DEBIT_NOTE);
    const body = client.createDebitNote.mock.calls[0][0];
    expect(body.type_document_id).toBe(5);
    expect(body.billing_reference).toEqual({ number: 'FV100', uuid: reference.uuid, issue_date: reference.issueDate });
    expect(body).toMatchObject({ discrepancyresponsecode: 3, sendmail: true, notes: 'Observaciones', head_note: 'Encabezado', foot_note: 'Pie', seze: 'REF' });
    expect(body.requested_monetary_totals).toMatchObject({ line_extension_amount: '180.00', tax_exclusive_amount: '180.00', tax_inclusive_amount: '214.20', allowance_total_amount: '10.00', payable_amount: '204.20' });
    expect(body.allowance_charges[0]).toMatchObject({ amount: '10.00', base_amount: '214.20' });
    expect(body.debit_note_lines[0]).toMatchObject({ code: 'ABC', invoiced_quantity: 2, price_amount: '100.00', notes: 'Detalle', line_extension_amount: '180.00' });
    for (const key of ['legal_monetary_totals', 'invoice_lines', 'credit_note_lines', 'payment_form', 'prefix', 'resolution_number']) expect(body).not.toHaveProperty(key);
    expect(client.createCreditNote).not.toHaveBeenCalled();
    expect(client.createInvoice).not.toHaveBeenCalled();
    expect(numbering.allocateResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.DEBIT_NOTE);
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({ documentKind: JarvisResolutionKind.DEBIT_NOTE, cufe: 'debit-code' }));
  });
  it('does not record or advance the number for rejected debit notes', async () => {
    const { service, request, client, history, numbering } = setup();
    client.createDebitNote.mockRejectedValue(new BadGatewayException('Rechazada'));
    await expect(service.createAndSendInvoice({ ...request, billingReference: reference, discrepancyResponseCode: 3, discrepancyResponseDescription: 'Motivo' }, 'company-1', JarvisResolutionKind.DEBIT_NOTE)).rejects.toThrow('Rechazada');
    expect(history.record).not.toHaveBeenCalled();
    expect(numbering.commitResolutionNumber).not.toHaveBeenCalled();
  });
  it('requires an original invoice reference', async () => {
    const { service, request, client } = setup();
    await expect(service.createAndSendInvoice(request, 'company-1', JarvisResolutionKind.DEBIT_NOTE)).rejects.toThrow('factura afectada');
    expect(client.createDebitNote).not.toHaveBeenCalled();
  });
});
