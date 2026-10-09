import { BadGatewayException } from '@nestjs/common';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { JarvisInvoiceSendService } from './jarvis-invoice-send.service';

function setup(
  token: string | null = ' company-token ',
  tercero: Record<string, unknown> = {
    name: 'Cliente',
    municipalityId: 149,
    typeRegimeId: 1,
  },
) {
  const queryRunner = {
    connect: jest.fn(), startTransaction: jest.fn(), query: jest.fn(),
    commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(),
  };
  const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
  const companies = { findById: jest.fn().mockResolvedValue({ nextPymeToken: token }) };
  const client = { createDebitNote: jest.fn().mockResolvedValue({ cude: 'debit-code' }), createCreditNote: jest.fn().mockResolvedValue({ cude: 'credit-code' }), createSupportCreditNote: jest.fn().mockResolvedValue({ cuds: 'adjustment-code' }), createSupportDocument: jest.fn().mockResolvedValue({ cuds: "support-code" }), createInvoice: jest.fn().mockResolvedValue({ success: true }) };
  const catalog = {
    getIvaTaxId: () => 1,
    getDefaultUnitMeasureId: () => 70,
    getDefaultItemIdentificationId: () => 4,
    getElectronicInvoiceTypeId: () => 1,
    getSupportDocumentTypeId: () => 11,
    resolveLiabilityId: jest.fn().mockResolvedValue(117),
    resolveCurrencyId: jest.fn().mockResolvedValue(35),
    resolveMunicipalityId: jest.fn().mockResolvedValue(149),
    resolveRegimeId: jest.fn().mockResolvedValue(1),
  };
  const numbering = {
    allocateResolutionNumber: jest.fn().mockResolvedValue({ prefix: 'FVJ', number: 1, formNumber: '18764113677438' }),
    commitResolutionNumber: jest.fn(),
  };
  const siigoNumbering = {
    allocateNumber: jest.fn().mockResolvedValue({ prefix: 'NC', number: 1, formNumber: null }),
    commitNumber: jest.fn(),
  };
  const history = { record: jest.fn().mockResolvedValue(undefined) };
  const integrations = {
    findByCompanyAndProvider: jest.fn().mockImplementation((_companyId: string, provider: string) => {
      if (provider === 'JARVIS') {
        return Promise.resolve({ credentials: { token_nextpyme: 'legacy-token' } });
      }
      return Promise.resolve(null);
    }),
  };
  const service = new JarvisInvoiceSendService(
    dataSource as never,
    integrations as never,
    { findByCompanyAndDocument: jest.fn().mockResolvedValue(tercero) } as never,
    companies as never, client as never, catalog as never, numbering as never, history as never,
    siigoNumbering as never,
  );
  const request = {
    issueDate: '2026-09-16', customerDocumentType: 'NIT', customerIdentification: '901335977',
    items: [{ description: 'Servicio', quantity: 1, unitValue: 250000, code: '01' }],
  };
  return { service, request, client, companies, numbering, history, integrations, siigoNumbering };
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
    expect(line.tax_totals).toEqual([{
      tax_id: 1,
      tax_amount: taxAmount > 0 ? '95.00' : '0.00',
      taxable_amount: '500.00',
      percent: taxAmount > 0 ? '19.00' : '0.00',
    }]);
  });

  it('factura de venta sin IVA envía tax_totals 0% en documento y líneas (FAU04)', async () => {
    const { service, request, client } = setup();
    await service.createAndSendInvoice({
      ...request,
      items: [{
        description: 'SERVICIO POR EL AÑO 2026',
        quantity: 1,
        unitValue: 450000,
        code: 'SERV-01',
        taxAmount: 0,
      }],
    }, 'company-1');

    const body = client.createInvoice.mock.calls[0][0];
    expect(body.tax_totals).toEqual([{
      tax_id: 1, tax_amount: '0.00', taxable_amount: '450000.00', percent: '0.00',
    }]);
    expect(body.invoice_lines[0].tax_totals).toEqual([{
      tax_id: 1, tax_amount: '0.00', taxable_amount: '450000.00', percent: '0.00',
    }]);
    expect(body.legal_monetary_totals.tax_exclusive_amount).toBe('450000.00');
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

  it('envía customer.name como cadena en factura de venta para persona natural', async () => {
    const { service, request, client } = setup(' company-token ', {
      name: 'BORDA BELTRAN LAURA SOFIA',
      documentNumber: '1032504904',
      municipalityId: 149,
      typeRegimeId: 2,
      entityType: 'natural_person',
    });
    await service.createAndSendInvoice({
      ...request,
      customerDocumentType: 'CC',
      customerIdentification: '1032504904',
      customerName: 'BORDA BELTRAN LAURA SOFIA',
    }, 'company-1');
    expect(typeof client.createInvoice.mock.calls[0][0].customer.name).toBe('string');
    expect(client.createInvoice.mock.calls[0][0].customer.name).toBe(
      'LAURA SOFIA BORDA BELTRAN',
    );
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

  it('reserva el consecutivo antes de enviar aunque Nextpyme rechace el XML', async () => {
    const { service, request, client, numbering } = setup();
    client.createInvoice.mockRejectedValue(new BadGatewayException('Regla: ZB01, Fallo en el Schema XML'));
    await expect(service.createAndSendInvoice(request, 'company-1')).rejects.toThrow('ZB01');
    expect(numbering.commitResolutionNumber).toHaveBeenCalledWith(
      'company-1',
      JarvisResolutionKind.ELECTRONIC_INVOICE,
      1,
    );
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
      tax_totals: [{ tax_id: 1, tax_amount: '0.00', taxable_amount: '250000.00', percent: '0.00' }],
      invoice_lines: [expect.objectContaining({
        type_generation_transmition_id: 1,
        start_date: request.issueDate,
        tax_totals: [{ tax_id: 1, tax_amount: '0.00', taxable_amount: '250000.00', percent: '0.00' }],
      })],
    }), 'company-token');
    expect(client.createSupportDocument.mock.calls[0][0]).not.toHaveProperty('customer');
    expect(numbering.allocateResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.SUPPORT_DOCUMENT);
    expect(numbering.commitResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.SUPPORT_DOCUMENT, 1);
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({ documentKind: JarvisResolutionKind.SUPPORT_DOCUMENT, cufe: 'support-code' }));
  });

  it('envía seller.name como cadena en documento soporte, aunque el tercero sea persona natural', async () => {
    const { service, request, client, numbering } = setup(' company-token ', {
      name: 'BORDA BELTRAN LAURA SOFIA',
      documentNumber: '1032504904',
      checkDigit: '4',
      municipalityId: 149,
      typeRegimeId: 2,
      entityType: 'natural_person',
    });
    numbering.allocateResolutionNumber.mockResolvedValue({ prefix: 'DSJ', number: 1, formNumber: '13028144278805' });
    await service.createAndSendInvoice({
      ...request,
      customerDocumentType: 'CC',
      customerIdentification: '1032504904',
      customerName: 'BORDA BELTRAN LAURA SOFIA',
    }, 'company-1', JarvisResolutionKind.SUPPORT_DOCUMENT);
    expect(client.createSupportDocument.mock.calls[0][0].seller.name).toBe(
      'BORDA BELTRAN LAURA SOFIA',
    );
  });
  it('un rechazo no guarda historial; el consecutivo ya se reservó antes del POST', async () => {
    const { service, request, client, numbering, history } = setup();
    client.createSupportDocument.mockRejectedValue(new Error('Rechazado'));
    await expect(service.createAndSendInvoice(request, 'company-1', JarvisResolutionKind.SUPPORT_DOCUMENT)).rejects.toThrow('Rechazado');
    expect(history.record).not.toHaveBeenCalled();
    expect(numbering.commitResolutionNumber).toHaveBeenCalledWith(
      'company-1',
      JarvisResolutionKind.SUPPORT_DOCUMENT,
      1,
    );
  });
});

describe('Notas credito Jarvis', () => {
  const reference = { number: 'SETP990000605', uuid: 'a'.repeat(96), issueDate: '2026-09-15' };
  it('envía el consecutivo recibido sin exigir ni modificar una resolución local', async () => {
    const { service, request, client, numbering } = setup();
    numbering.allocateResolutionNumber.mockRejectedValue(new Error('Sin configuración local'));
    await service.createAndSendInvoice({ ...request, number: 27, prefix: 'NC', billingReference: reference,
      discrepancyResponseCode: 2, discrepancyResponseDescription: 'Devolución',
    }, 'company-1', JarvisResolutionKind.CREDIT_NOTE);
    expect(client.createCreditNote).toHaveBeenCalledWith(expect.objectContaining({ number: 27, prefix: 'NC' }), 'company-token');
    expect(client.createCreditNote.mock.calls[0][0]).not.toHaveProperty('resolution_number');
    expect(numbering.allocateResolutionNumber).not.toHaveBeenCalled();
    expect(numbering.commitResolutionNumber).not.toHaveBeenCalled();
  });
  it('conserva el rechazo del proveedor y el consecutivo explícito sin alterarlo', async () => {
    const { service, request, client, numbering, history } = setup();
    client.createCreditNote.mockRejectedValue(new BadGatewayException('Documento procesado anteriormente'));
    await expect(service.createAndSendInvoice({ ...request, number: 27, prefix: 'NC', billingReference: reference,
      discrepancyResponseCode: 2, discrepancyResponseDescription: 'Devolución',
    }, 'company-1', JarvisResolutionKind.CREDIT_NOTE)).rejects.toThrow('Documento procesado anteriormente');
    expect(numbering.commitResolutionNumber).not.toHaveBeenCalled();
    expect(history.record).not.toHaveBeenCalled();
  });
  it('envia referencia, motivo y lineas al servicio correcto y usa numeracion independiente', async () => {
    const {service, request, client, numbering, history} = setup();
    await service.createAndSendInvoice({ ...request, billingReference: reference,
      discrepancyResponseCode: 2, discrepancyResponseDescription: 'Devolucion', seze: '2026', sendmail: true,
      items: [{ description: 'Servicio', quantity: 2, unitValue: 100, discount: 20, taxAmount: 34.2, notes: 'Detalle' }],
      payment: { id: 10 },
      retentions: [{ id: 7, type: 'ReteICA', percentage: 4.14 }],
    }, 'company-1', JarvisResolutionKind.CREDIT_NOTE);
    expect(client.createInvoice).not.toHaveBeenCalled();
    expect(client.createSupportDocument).not.toHaveBeenCalled();
    const payload = client.createCreditNote.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({ type_document_id: 4,
      billing_reference: { number: reference.number, uuid: reference.uuid, issue_date: reference.issueDate },
      discrepancyresponsecode: 2, discrepancyresponsedescription: 'Devolucion', sendmail: true, seze: '2026',
      legal_monetary_totals: {
        line_extension_amount: '180.00',
        tax_exclusive_amount: '180.00',
        tax_inclusive_amount: '214.20',
        payable_amount: '214.20',
      },
    }));
    expect(payload).not.toHaveProperty('with_holding_tax_total');
    expect(payload).not.toHaveProperty('payment_form');
    expect(payload).not.toHaveProperty('type_currency_id');
    expect(payload).not.toHaveProperty('allowance_charges');
    expect(payload.legal_monetary_totals).not.toHaveProperty('allowance_total_amount');
    expect(payload.legal_monetary_totals).not.toHaveProperty('charge_total_amount');
    const payloadKeys = Object.keys(payload);
    expect(payloadKeys.indexOf('tax_totals')).toBeLessThan(payloadKeys.indexOf('legal_monetary_totals'));
    expect(payloadKeys.indexOf('legal_monetary_totals')).toBeLessThan(payloadKeys.indexOf('credit_note_lines'));
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
  it('no registra una nota rechazada; el consecutivo ya se reservó antes del POST', async () => {
    const { service, request, client, numbering, history } = setup();
    client.createCreditNote.mockRejectedValue(new BadGatewayException('Rechazada'));
    await expect(service.createAndSendInvoice({ ...request, billingReference: reference, discrepancyResponseCode: 2, discrepancyResponseDescription: 'Motivo' }, 'company-1', JarvisResolutionKind.CREDIT_NOTE)).rejects.toThrow('Rechazada');
    expect(history.record).not.toHaveBeenCalled();
    expect(numbering.commitResolutionNumber).toHaveBeenCalledWith(
      'company-1',
      JarvisResolutionKind.CREDIT_NOTE,
      1,
    );
  });
});

describe('Notas de ajuste de documento soporte', () => {
  const reference = { number: 'DS1', uuid: 'b'.repeat(96), issueDate: '2026-09-01' };

  it('envía seller y credit_note_lines al sd-credit-note con numeración NDS', async () => {
    const { service, request, client, numbering, history } = setup();
    numbering.allocateResolutionNumber.mockResolvedValue({ prefix: 'NDS', number: 1, formNumber: null });
    await service.createAndSendInvoice({
      ...request,
      billingReference: reference,
      discrepancyResponseCode: 2,
      discrepancyResponseDescription: 'Devolución',
      items: [{ description: 'COMISION POR SERVICIOS', quantity: 1, unitValue: 200, taxAmount: 0, code: 'COMISION' }],
    }, 'company-1', JarvisResolutionKind.SUPPORT_CREDIT_NOTE);

    expect(client.createCreditNote).not.toHaveBeenCalled();
    expect(client.createSupportDocument).not.toHaveBeenCalled();
    expect(numbering.allocateResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.SUPPORT_CREDIT_NOTE);
    const payload = client.createSupportCreditNote.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      type_document_id: 13,
      prefix: 'NDS',
      billing_reference: { number: 'DS1', uuid: reference.uuid, issue_date: '2026-09-01' },
      discrepancyresponsecode: 2,
    }));
    expect(payload).not.toHaveProperty('customer');
    expect(payload).not.toHaveProperty('invoice_lines');
    expect(payload.seller).toEqual(expect.objectContaining({ name: 'Cliente', merchant_registration: '0000000-00', postal_zone_code: '000000' }));
    expect(payload.credit_note_lines[0]).toEqual(expect.objectContaining({
      description: 'COMISION POR SERVICIOS',
      invoiced_quantity: '1',
      price_amount: '200.00',
    }));
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({
      documentKind: JarvisResolutionKind.SUPPORT_CREDIT_NOTE,
      cufe: 'adjustment-code',
    }));
  });

  it('rechaza referencia inválida del documento soporte antes de numerar', async () => {
    const { service, request, numbering } = setup();
    await expect(service.createAndSendInvoice({
      ...request,
      billingReference: { ...reference, uuid: 'corto' },
      discrepancyResponseCode: 2,
      discrepancyResponseDescription: 'Motivo',
    }, 'company-1', JarvisResolutionKind.SUPPORT_CREDIT_NOTE)).rejects.toThrow('documento soporte afectado');
    expect(numbering.allocateResolutionNumber).not.toHaveBeenCalled();
  });
});

describe('Notas credito SIIGO via NextPyme', () => {
  const reference = { number: 'FVJ1', uuid: 'a'.repeat(96), issueDate: '2026-09-16' };

  it('usa contador soft NC desde 1 y envía los campos del credit-note', async () => {
    const { service, request, client, integrations, numbering, siigoNumbering, history } = setup();
    integrations.findByCompanyAndProvider.mockImplementation((_id: string, provider: string) => {
      if (provider === 'JARVIS') return Promise.resolve(null);
      if (provider === 'SIIGO') return Promise.resolve({ credentials: { username: 'u', access_key: 'k' } });
      return Promise.resolve(null);
    });

    await service.createAndSendInvoice({
      ...request,
      billingReference: reference,
      discrepancyResponseCode: 2,
      discrepancyResponseDescription: 'ANULACION DE FACTURA ELECTRONICA',
      observations: 'ANULACION TOTAL DE LA FACTURA ELECTRONICA FVJ1',
      headNote: 'NOTA CREDITO ELECTRONICA - ANULACION DE FACTURA FVJ1',
      footNote: 'NOTA CREDITO ELECTRONICA GENERADA POR JARVIS COLOMBIA S.A.S.',
      seze: '2021-2017',
      items: [{
        description: 'Servicio mensual',
        quantity: 1,
        unitValue: 250000,
        taxAmount: 0,
        notes: 'ANULACION TOTAL DEL SERVICIO FACTURADO EN FVJ1',
        code: '01',
      }],
    }, 'company-1', JarvisResolutionKind.CREDIT_NOTE);

    const payload = client.createCreditNote.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      prefix: 'NC',
      number: 1,
      type_document_id: 4,
      billing_reference: {
        number: 'FVJ1',
        uuid: reference.uuid,
        issue_date: '2026-09-16',
      },
      discrepancyresponsecode: 2,
      seze: '2021-2017',
      head_note: 'NOTA CREDITO ELECTRONICA - ANULACION DE FACTURA FVJ1',
      foot_note: 'NOTA CREDITO ELECTRONICA GENERADA POR JARVIS COLOMBIA S.A.S.',
      tax_totals: [{
        tax_id: 1,
        tax_amount: '0.00',
        taxable_amount: '250000.00',
        percent: '0.00',
      }],
    }));
    expect(payload).not.toHaveProperty('resolution_number');
    expect(payload.credit_note_lines[0]).toEqual(expect.objectContaining({
      tax_totals: [{
        tax_id: 1,
        tax_amount: '0.00',
        taxable_amount: '250000.00',
        percent: '0.00',
      }],
      notes: 'ANULACION TOTAL DEL SERVICIO FACTURADO EN FVJ1',
      code: '01',
    }));
    expect(numbering.allocateResolutionNumber).not.toHaveBeenCalled();
    expect(siigoNumbering.allocateNumber).toHaveBeenCalledWith('company-1');
    expect(siigoNumbering.commitNumber).toHaveBeenCalledWith('company-1', 1);
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({
      documentKind: JarvisResolutionKind.CREDIT_NOTE,
      prefix: 'NC',
    }));
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
      retentions: [{ id: 7, type: 'ReteICA', percentage: 4.14 }],
    }, 'company-1', JarvisResolutionKind.DEBIT_NOTE);
    const body = client.createDebitNote.mock.calls[0][0];
    expect(body.type_document_id).toBe(5);
    expect(body.billing_reference).toEqual({ number: 'FV100', uuid: reference.uuid, issue_date: reference.issueDate });
    expect(body).toMatchObject({ discrepancyresponsecode: 3, sendmail: true, notes: 'Observaciones', head_note: 'Encabezado', foot_note: 'Pie', seze: 'REF' });
    expect(body.requested_monetary_totals).toMatchObject({ line_extension_amount: '180.00', tax_exclusive_amount: '180.00', tax_inclusive_amount: '214.20', allowance_total_amount: '10.00', payable_amount: '204.20' });
    expect(body.allowance_charges[0]).toMatchObject({ amount: '10.00', base_amount: '214.20' });
    expect(body.debit_note_lines[0]).toMatchObject({ code: 'ABC', invoiced_quantity: 2, price_amount: '100.00', notes: 'Detalle', line_extension_amount: '180.00' });
    expect(body).not.toHaveProperty('with_holding_tax_total');
    expect(body).not.toHaveProperty('type_currency_id');
    const bodyKeys = Object.keys(body);
    expect(bodyKeys.indexOf('tax_totals')).toBeLessThan(bodyKeys.indexOf('requested_monetary_totals'));
    for (const key of ['legal_monetary_totals', 'invoice_lines', 'credit_note_lines', 'payment_form', 'prefix', 'resolution_number']) expect(body).not.toHaveProperty(key);
    expect(client.createCreditNote).not.toHaveBeenCalled();
    expect(client.createInvoice).not.toHaveBeenCalled();
    expect(numbering.allocateResolutionNumber).toHaveBeenCalledWith('company-1', JarvisResolutionKind.DEBIT_NOTE);
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({ documentKind: JarvisResolutionKind.DEBIT_NOTE, cufe: 'debit-code' }));
  });
  it('does not record a rejected debit note; consecutive was reserved before POST', async () => {
    const { service, request, client, history, numbering } = setup();
    client.createDebitNote.mockRejectedValue(new BadGatewayException('Rechazada'));
    await expect(service.createAndSendInvoice({ ...request, billingReference: reference, discrepancyResponseCode: 3, discrepancyResponseDescription: 'Motivo' }, 'company-1', JarvisResolutionKind.DEBIT_NOTE)).rejects.toThrow('Rechazada');
    expect(history.record).not.toHaveBeenCalled();
    expect(numbering.commitResolutionNumber).toHaveBeenCalledWith(
      'company-1',
      JarvisResolutionKind.DEBIT_NOTE,
      1,
    );
  });
  it('requires an original invoice reference', async () => {
    const { service, request, client } = setup();
    await expect(service.createAndSendInvoice(request, 'company-1', JarvisResolutionKind.DEBIT_NOTE)).rejects.toThrow('factura afectada');
    expect(client.createDebitNote).not.toHaveBeenCalled();
  });
});
