import { AdminService } from './admin.service';
import { Company } from '../company/entities/company.entity';

function setup() {
  const companies = ['a', 'b'].map(id => ({ id, nit: id, name: `Cliente ${id}`, createdAt: new Date('2026-01-01T15:00:00Z'), integrations: [], commercialActivity: [] })) as unknown as Company[];
  const findById = jest.fn(async id => companies.find(item => item.id === id) ?? null);
  const save = jest.fn(async value => value);
  const database = { transaction: async work => work({ getRepository: () => ({ findOne: ({ where }) => findById(where.id), save }) }) };
  const integrations = { findAllByCompanyId: jest.fn().mockResolvedValue([]) };
  const service = new AdminService(database as never, { findById } as never, {} as never, integrations as never,
    { resolveIncludedDocumentTypes: () => [] } as never, {} as never, {} as never, {} as never);
  return { service, companies, save, integrations };
}

it('persiste comentarios del cliente elegido sin mezclar su historial con otro cliente', async () => {
  const { service, companies, integrations } = setup();
  const response = await service.addCompanyComment('a', '  Contactar antes de renovar.  ');
  expect(response.activity).toEqual([expect.objectContaining({ kind: 'COMMENT', text: 'Contactar antes de renovar.', id: expect.any(String), createdAt: expect.any(String) })]);
  expect((await service.companyDetails('a')).activity).toEqual(response.activity);
  expect(companies[1].commercialActivity).toEqual([]);
  expect(integrations.findAllByCompanyId).toHaveBeenCalledWith('a');
});

it('guarda los datos de contacto sin alterar planes ni el historial', async () => {
  const { service, companies } = setup();
  await service.addCompanyComment('a', 'Nota existente');
  const result = await service.updateCompanyProfile('a', { name: ' Nueva razón social ', commercial: ' Laura ', responsible: { name: 'Contacto', phone: '3105551234', email: 'CONTACTO@example.com' } });
  expect(result.company).toMatchObject({ name: 'Nueva razón social', commercial: 'Laura', responsible: { name: 'Contacto', phone: '3105551234', email: 'contacto@example.com' } });
  expect(result.activity).toHaveLength(1);
  expect(companies[1].name).toBe('Cliente b');
});

it('rechaza comentarios vacíos, demasiado largos y clientes inexistentes', async () => {
  const { service, save } = setup();
  await expect(service.addCompanyComment('a', ' ')).rejects.toThrow('comentario');
  await expect(service.addCompanyComment('a', 'a'.repeat(2001))).rejects.toThrow('comentario');
  await expect(service.addCompanyComment('missing', 'Texto')).rejects.toThrow('Empresa no encontrada');
  expect(save).not.toHaveBeenCalled();
});
