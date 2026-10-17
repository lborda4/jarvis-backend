import { of, throwError } from 'rxjs';
import { JarvisRadianService } from './jarvis-radian.service';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';

function eventStore() {
  const rows = new Map<string, any>();
  return {
    rows,
    list: jest.fn(async (companyId, cufe) =>
      [...rows.values()].filter(
        (row) => row.companyId === companyId && row.cufe === cufe,
      ),
    ),
    claim: jest.fn(async (companyId, cufe, eventId, rejectionId) => {
      const key = [companyId, cufe, eventId].join(':');
      const row = rows.get(key);
      if (row && row.status !== 'failed') return { claimed: false, row };
      const opposite = rows.get(
        [companyId, cufe, eventId === 2 ? 4 : 2].join(':'),
      );
      if ([2, 4].includes(eventId) && opposite && opposite.status !== 'failed')
        throw new Error('evento final');
      const next = {
        companyId,
        cufe,
        eventId,
        rejectionId,
        status: 'processing',
        attemptId: key,
      };
      rows.set(key, next);
      return { claimed: true, row: next };
    }),
    complete: jest.fn(async (row, result) => {
      Object.assign(row, result);
    }),
  };
}

describe('RADIAN por empresa', () => {
  const cufe = 'a'.repeat(96);
  function setup() {
    const companies = {
      findById: jest.fn().mockResolvedValue({ nextPymeToken: 'owner-token' }),
    };
    const integrations = {
      findByCompanyAndProvider: jest
        .fn()
        .mockResolvedValue({ subscriptionStatus: 'ACTIVE' }),
    };
    const client = {
      sendRadianEvent: jest.fn().mockResolvedValue({ status: 'sent' }),
    };
    return {
      service: new JarvisRadianService(
        companies as never,
        integrations as never,
        client as never,
        eventStore() as never,
      ),
      companies,
      integrations,
      client,
    };
  }
  it.each([1, 3, 4])(
    'usa el token de la empresa y el payload RADIAN del evento %s',
    async (eventId) => {
      const { service, client, integrations } = setup();
      await expect(service.send('owner', { cufe, eventId })).resolves.toEqual({
        status: 'sent',
      });
      expect(integrations.findByCompanyAndProvider).toHaveBeenCalledWith(
        'owner',
        'JARVIS',
      );
      expect(client.sendRadianEvent).toHaveBeenCalledWith(
        {
          event_id: eventId,
          type_rejection_id: null,
          document_reference: { cufe },
        },
        'owner-token',
      );
    },
  );
  it('bloquea SIIGO o suscripciones inactivas antes de enviar', async () => {
    const { service, integrations, client } = setup();
    integrations.findByCompanyAndProvider.mockResolvedValue(null as never);
    await expect(
      service.send('siigo-company', { cufe, eventId: 1 }),
    ).rejects.toThrow();
    integrations.findByCompanyAndProvider.mockResolvedValue({
      subscriptionStatus: 'INACTIVE',
    });
    await expect(service.send('owner', { cufe, eventId: 1 })).rejects.toThrow();
    expect(client.sendRadianEvent).not.toHaveBeenCalled();
  });
  it('permite RADIAN sin plan ni resoluciones con integración Jarvis y token', async () => {
    const { service, integrations, client } = setup();
    integrations.findByCompanyAndProvider.mockResolvedValue({
      subscriptionStatus: null,
    } as never);
    await expect(service.send('owner', { cufe, eventId: 1 })).resolves.toEqual({
      status: 'sent',
    });
    expect(client.sendRadianEvent).toHaveBeenCalledTimes(1);
  });
  it('rechaza CUFE inválidos, reclamos y eventos no habilitados', async () => {
    const { service, client } = setup();
    for (const request of [
      { cufe: 'bad', eventId: 1 },
      { cufe, eventId: 2 },
      { cufe, eventId: 5 },
    ])
      await expect(service.send('owner', request)).rejects.toThrow();
    expect(client.sendRadianEvent).not.toHaveBeenCalled();
  });
  it('evita volver a enviar eventos ya confirmados durante la ejecución del servidor', async () => {
    const { service, client } = setup();
    await service.send('owner', { cufe, eventId: 1 });
    await service.send('owner', { cufe, eventId: 1 });
    expect(client.sendRadianEvent).toHaveBeenCalledTimes(1);
    await service.send('other-company', { cufe, eventId: 1 });
    expect(client.sendRadianEvent).toHaveBeenCalledTimes(2);
  });
});

describe('confirmación DIAN de eventos RADIAN', () => {
  function setup() {
    const http = { post: jest.fn() };
    const config = {
      get: jest.fn((key: string) =>
        key === 'nextPyme.baseUrl' ? 'https://example.test/ubl2.1' : undefined,
      ),
    };
    const client = new NextPymeApiClient(http as never, config as never);
    return { client, http };
  }
  const payload = {
    event_id: 1 as const,
    type_rejection_id: null,
    document_reference: { cufe: 'a'.repeat(96) },
  };
  it('comprueba IsValid incluso si success es true', async () => {
    const { client, http } = setup();
    http.post.mockReturnValue(
      of({
        status: 200,
        data: { success: true, ResponseDian: { IsValid: 'false' } },
      }),
    );
    expect(
      await client.sendRadianEvent(payload, 'company-token'),
    ).toMatchObject({ status: 'failed' });
    http.post.mockReturnValue(
      of({ status: 200, data: { ResponseDian: { IsValid: 'true' } } }),
    );
    expect(
      await client.sendRadianEvent(payload, 'company-token'),
    ).toMatchObject({ status: 'sent' });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/send-event-data'),
      { ...payload, sendmail: false },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer company-token',
        }),
      }),
    );
  });
  it('no confirma un evento con un código DIAN contradictorio', async () => {
    const { client, http } = setup();
    http.post.mockReturnValue(
      of({
        status: 200,
        data: {
          success: true,
          ResponseDian: { IsValid: 'true', StatusCode: '99' },
        },
      }),
    );
    expect(
      await client.sendRadianEvent(payload, 'company-token'),
    ).toMatchObject({ status: 'unknown' });
  });
  it('no declara éxito sin confirmación DIAN o tras un timeout', async () => {
    const { client, http } = setup();
    http.post.mockReturnValue(of({ status: 200, data: { success: true } }));
    expect(
      await client.sendRadianEvent(payload, 'company-token'),
    ).toMatchObject({ status: 'unknown' });
    http.post.mockReturnValue(throwError(() => new Error('timeout')));
    expect(
      await client.sendRadianEvent(payload, 'company-token'),
    ).toMatchObject({ status: 'unknown' });
  });
  it('consulta por CUDE y mantiene desconocido ante errores de consulta', async () => {
    const { client, http } = setup();
    http.post.mockReturnValue(
      of({ status: 404, data: { message: 'No encontrado' } }),
    );
    expect(
      await client.getRadianEventStatus('event-cude', 'company-token'),
    ).toMatchObject({ status: 'unknown', cude: 'event-cude' });
    expect(http.post).toHaveBeenCalledWith(
      'https://example.test/ubl2.1/status/document/event-cude',
      {},
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer company-token',
        }),
      }),
    );
  });
});

describe('historial persistente RADIAN', () => {
  const cufe = 'a'.repeat(96);
  function setup(store = eventStore()) {
    const companies = {
      findById: jest.fn().mockResolvedValue({ nextPymeToken: 'token' }),
    };
    const integrations = {
      findByCompanyAndProvider: jest
        .fn()
        .mockResolvedValue({ subscriptionStatus: 'ACTIVE' }),
    };
    const client = {
      sendRadianEvent: jest
        .fn()
        .mockResolvedValue({
          status: 'sent',
          cude: 'event-cude',
          response: { IsValid: 'true' },
        }),
      getRadianEventStatus: jest
        .fn()
        .mockResolvedValue({ status: 'sent', cude: 'event-cude' }),
    };
    return {
      store,
      client,
      service: new JarvisRadianService(
        companies as never,
        integrations as never,
        client as never,
        store as never,
      ),
    };
  }
  it('recupera CUDE tras reiniciar el servicio sin volver a emitir', async () => {
    const first = setup();
    await first.service.send('company', { cufe, eventId: 1 });
    const restarted = setup(first.store);
    expect(
      await restarted.service.send('company', { cufe, eventId: 1 }),
    ).toEqual({ status: 'sent', cude: 'event-cude' });
    expect(restarted.client.sendRadianEvent).not.toHaveBeenCalled();
  });
  it('bloquea reenvíos si se perdió la respuesta y no hay CUDE', async () => {
    const { service, client } = setup();
    client.sendRadianEvent.mockResolvedValue({ status: 'unknown' } as never);
    await service.send('company', { cufe, eventId: 1 });
    await service.send('company', { cufe, eventId: 1 });
    expect(client.sendRadianEvent).toHaveBeenCalledTimes(1);
  });
  it('dos instancias comparten la reserva sin emitir dos veces', async () => {
    const first = setup();
    const second = setup(first.store);
    await Promise.all([
      first.service.send('company', { cufe, eventId: 1 }),
      second.service.send('company', { cufe, eventId: 1 }),
    ]);
    expect(
      first.client.sendRadianEvent.mock.calls.length +
        second.client.sendRadianEvent.mock.calls.length,
    ).toBe(1);
  });
  it('reconcilia duplicados con CUDE mediante consulta, no mediante reenvío', async () => {
    const { service, client, store } = setup();
    client.sendRadianEvent.mockResolvedValue({
      status: 'unknown',
      cude: 'event-cude',
    } as never);
    expect(await service.send('company', { cufe, eventId: 1 })).toEqual({
      status: 'sent',
      cude: 'event-cude',
    });
    expect(client.getRadianEventStatus).toHaveBeenCalledWith(
      'event-cude',
      'token',
    );
    expect(store.complete).toHaveBeenCalledTimes(2);
  });
  it('recupera un pendiente con CUDE sin volver a emitir el evento', async () => {
    const { service, client } = setup();
    client.sendRadianEvent.mockResolvedValue({ status: 'unknown', cude: 'event-cude' } as never);
    client.getRadianEventStatus.mockResolvedValueOnce({ status: 'unknown', cude: 'event-cude' } as never);
    await service.send('company', { cufe, eventId: 1 });
    expect(await service.send('company', { cufe, eventId: 1 })).toEqual({ status: 'sent', cude: 'event-cude' });
    expect(client.sendRadianEvent).toHaveBeenCalledTimes(1);
    expect(client.getRadianEventStatus).toHaveBeenCalledTimes(2);
  });
  it('explica el pendiente sin CUDE y no crea un segundo envio', async () => {
    const { service, client } = setup();
    client.sendRadianEvent.mockResolvedValue({ status: 'unknown' } as never);
    await service.send('company', { cufe, eventId: 1 });
    expect(await service.send('company', { cufe, eventId: 1 })).toMatchObject({ status: 'unknown', message: expect.stringContaining('soporte') });
    expect(client.sendRadianEvent).toHaveBeenCalledTimes(1);
    expect(client.getRadianEventStatus).not.toHaveBeenCalled();
  });
  it('no incluye la respuesta cruda en el historial público', async () => {
    const { service } = setup();
    await service.send('company', { cufe, eventId: 1 });
    const result = await service.history('company', cufe);
    expect(result.events[0]).toMatchObject({
      cude: 'event-cude',
      status: 'sent',
    });
    expect(result.events[0]).not.toHaveProperty('response');
    expect((await service.history('other-company', cufe)).events).toEqual([]);
  });
});

describe('consulta de facturas y reclamos RADIAN', () => {
  const cufe = 'a'.repeat(96);
  function setup() {
    const companies = {
      findById: jest
        .fn()
        .mockResolvedValue({
          nit: '900123456-7',
          nextPymeToken: 'owner-token',
        }),
    };
    const integrations = {
      findByCompanyAndProvider: jest
        .fn()
        .mockResolvedValue({ subscriptionStatus: 'ACTIVE' }),
    };
    const data = {
      number: '123',
      prefix: 'FE',
      date: '2026-10-13',
      type_document_id: 1,
      payment_form: { payment_form_id: 2 },
      seller: { name: 'Vendedor', identification_number: '901234567' },
      customer: { identification_number: '900123456' },
    };
    const client = {
      getInvoiceByCufe: jest.fn().mockResolvedValue({ outcome: 'found', data }),
      fetchMasterTable: jest
        .fn()
        .mockResolvedValue([{ id: 1, name: 'Motivo' }]),
      sendRadianEvent: jest.fn().mockResolvedValue({ status: 'sent' }),
    };
    return {
      service: new JarvisRadianService(
        companies as never,
        integrations as never,
        client as never,
        eventStore() as never,
      ),
      client,
      integrations,
      data,
    };
  }
  it('consulta el CUFE manual con el token de la empresa y devuelve los datos de la tabla', async () => {
    const { service, client } = setup();
    expect(await service.lookup('owner', cufe)).toEqual({
      cufe,
      number: 'FE123',
      date: '2026-10-13',
      supplier: 'Vendedor',
      nit: '901234567',
      valid: true,
    });
    expect(client.getInvoiceByCufe).toHaveBeenCalledWith(cufe, 'owner-token');
  });
  it('no devuelve la factura si pertenece a otra empresa', async () => {
    const { service, client, data } = setup();
    client.getInvoiceByCufe.mockResolvedValue({
      outcome: 'found',
      data: { ...data, customer: { identification_number: '999' } },
    });
    await expect(service.lookup('owner', cufe)).rejects.toThrow(
      'empresa activa',
    );
  });
  it.each([1, null, undefined])('rechaza contado o forma de pago ausente: %s', async paymentForm => {
    const { service, client, data } = setup();
    client.getInvoiceByCufe.mockResolvedValue({ outcome: 'found', data: { ...data, payment_form: { payment_form_id: paymentForm } } });
    await expect(service.lookup('owner', cufe)).rejects.toThrow('crédito');
  });
  it.each([11, 4, null, undefined])('rechaza documentos distintos de factura o sin tipo: %s', async documentType => {
    const { service, client, data } = setup();
    client.getInvoiceByCufe.mockResolvedValue({ outcome: 'found', data: { ...data, type_document_id: documentType } });
    await expect(service.lookup('owner', cufe)).rejects.toThrow('factura electrónica de venta');
  });
  it.each(['', null, undefined, '21111967'])('rechaza comprador ausente o ajeno: %s', async identification => {
    const { service, client, data } = setup();
    client.getInvoiceByCufe.mockResolvedValue({ outcome: 'found', data: { ...data, customer: { identification_number: identification } } });
    await expect(service.lookup('owner', cufe)).rejects.toThrow('Verifica la información');
  });
  it('acepta códigos de texto e identifica el NIT sin separadores', async () => {
    const { service, client, data } = setup();
    client.getInvoiceByCufe.mockResolvedValue({ outcome: 'found', data: { ...data, type_document_id: '1', payment_form: { payment_form_id: '2' }, customer: { identification_number: '900.123.456-7' } } });
    await expect(service.lookup('owner', cufe)).resolves.toMatchObject({ valid: true });
  });
  it('distingue factura inexistente de un fallo de consulta', async () => {
    const { service, client } = setup();
    client.getInvoiceByCufe.mockResolvedValue({ outcome: 'not_found' });
    await expect(service.lookup('owner', cufe)).rejects.toThrow('Verifica la información');
    client.getInvoiceByCufe.mockResolvedValue({ outcome: 'error' });
    await expect(service.lookup('owner', cufe)).rejects.toThrow('No pudimos consultar');
  });
  it('envía el reclamo con type_rejection_id obligatorio', async () => {
    const { service, client } = setup();
    await service.send('owner', { cufe, eventId: 2, typeRejectionId: 1 });
    expect(client.sendRadianEvent).toHaveBeenCalledWith(
      { event_id: 2, type_rejection_id: 1, document_reference: { cufe } },
      'owner-token',
    );
  });
  it('rechaza motivos que no están en el catálogo', async () => {
    const { service, client } = setup();
    await expect(
      service.send('owner', { cufe, eventId: 2, typeRejectionId: 999 }),
    ).rejects.toThrow();
    expect(client.sendRadianEvent).not.toHaveBeenCalled();
  });
  it('impide aceptar y reclamar la misma factura ya confirmada', async () => {
    const { service } = setup();
    await service.send('owner', { cufe, eventId: 4 });
    await expect(
      service.send('owner', { cufe, eventId: 2, typeRejectionId: 1 }),
    ).rejects.toThrow('evento final');
  });
});
