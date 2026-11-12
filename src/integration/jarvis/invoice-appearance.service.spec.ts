import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceAppearanceService } from './invoice-appearance.service';
import { InvoiceAppearanceController } from './invoice-appearance.controller';
import { normalizeJarvisCredentials } from './helpers/jarvis-credentials.helper';

describe('personalización de facturas por empresa', () => {
  const appearance = { accentColor: '#123456', footerText: 'Gracias.', showLogo: false };
  function setup() {
    const db = { query: jest.fn() };
    return { db, service: new InvoiceAppearanceService(db as never) };
  }
  it('consulta solo la integración activa de la empresa autenticada', async () => {
    const { service, db } = setup();
    db.query.mockResolvedValue([{ appearance }]);
    expect(await service.get('owner')).toEqual(appearance);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("company_id=$1 AND provider='JARVIS' AND active=true"), ['owner']);
  });
  it('guarda solo la clave de diseño sin reemplazar las credenciales o resoluciones', async () => {
    const { service, db } = setup();
    db.query.mockResolvedValue([[{ appearance }], 1]);
    expect(await service.save('owner', { ...appearance, accentColor: '123456', footerText: ' Gracias. ', companyId: 'other' })).toEqual(appearance);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("jsonb_set(COALESCE(credentials, '{}'::jsonb), '{invoice_appearance}', $2::jsonb, true)"), ['owner', JSON.stringify(appearance)]);
  });
  it.each([null, [], {}, { ...appearance, accentColor: '#zzzzzz' }, { ...appearance, accentColor: 'red' }, { ...appearance, footerText: 'a'.repeat(301) }, { ...appearance, showLogo: 'false' }])('rechaza entradas inválidas antes de escribir', async input => {
    const { service, db } = setup();
    await expect(service.save('owner', input)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('no inventa un guardado si no hay integración activa', async () => {
    const { service, db } = setup();
    db.query.mockResolvedValue([]);
    await expect(service.get('owner')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.save('owner', appearance)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('conserva las preferencias al normalizar los datos de empresa para otros guardados', () => {
    expect(normalizeJarvisCredentials({ business_name: 'Mi empresa', invoice_appearance: appearance }).invoice_appearance).toEqual(appearance);
  });
  it('el controlador toma la empresa del JWT y no del cuerpo', async () => {
    const service = { get: jest.fn(), save: jest.fn() };
    const controller = new InvoiceAppearanceController(service as never);
    const user = { companyId: 'owner' } as never;
    controller.get(user);
    controller.save(user, { ...appearance, companyId: 'other' });
    expect(service.get).toHaveBeenCalledWith('owner');
    expect(service.save).toHaveBeenCalledWith('owner', expect.objectContaining({ companyId: 'other' }));
  });
});
