import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const updatedAt = '2026-11-16T14:00:00.000Z';
const entry = (id = first) => ({ id, updatedAt, state: { employeeId: id, lines: [] } });
function setup(rows = [first, second].map(id => ({ id, updated_at: updatedAt, status: 'DRAFT' }))) {
  const query = jest.fn(async (sql: string) => sql.includes('SELECT id,updated_at,status') ? rows : []);
  const manager = { query };
  const committed: string[] = [];
  let pending: string[] = [];
  const db = { transaction: jest.fn(async (callback: (m: unknown) => Promise<unknown>) => {
    pending = [];
    const result = await callback(manager);
    committed.push(...pending);
    return result;
  }) };
  const service = new PayrollService(db as never, {} as never, {} as never, {} as never);
  const save = jest.spyOn(service, 'saveDocument').mockImplementation(async (_company, _actor, id) => { pending.push(id); return { id }; });
  return { service, query, db, manager, save, committed };
}
describe('guardado conjunto de novedades', () => {
  it('expone un único PUT bajo el controlador protegido de nómina', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PayrollController.prototype.saveBatch)).toBe('documents');
    expect(Reflect.getMetadata(METHOD_METADATA, PayrollController.prototype.saveBatch)).toBe(RequestMethod.PUT);
  });
  it('guarda todos los estados con el mismo manager y las validaciones normales', async () => {
    const { service, db, manager, save, query, committed } = setup();
    await expect(service.saveDocuments('company', 'actor', { documents: [entry(), entry(second)] })).resolves.toEqual({ saved: [first, second] });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1]).toEqual([expect.stringContaining('WHERE company_id=$1'), ['company', [first, second]]]);
    expect(save).toHaveBeenNthCalledWith(1, 'company', 'actor', first, entry().state, manager);
    expect(save).toHaveBeenNthCalledWith(2, 'company', 'actor', second, entry(second).state, manager);
    expect(committed).toEqual([first, second]);
  });
  it('no confirma escrituras parciales si falla la validación de otro empleado', async () => {
    const { service, save, committed } = setup();
    save.mockImplementationOnce(async () => ({ id: first })).mockRejectedValueOnce(new Error('Novedad inválida'));
    await expect(service.saveDocuments('company', 'actor', { documents: [entry(), entry(second)] })).rejects.toThrow('Novedad inválida');
    expect(committed).toEqual([]);
  });
  it.each(['ACCEPTED', 'PROCESSING', 'UNCERTAIN'])('rechaza un documento %s antes de guardar cualquiera', async status => {
    const { service, save } = setup([{ id: first, status: 'DRAFT', updated_at: updatedAt }, { id: second, status, updated_at: updatedAt }]);
    await expect(service.saveDocuments('company', 'actor', { documents: [entry(), entry(second)] })).rejects.toThrow('No se guardó ningún cambio');
    expect(save).not.toHaveBeenCalled();
  });
  it('detecta cambios concurrentes antes de guardar cualquiera', async () => {
    const { service, save } = setup([{ id: first, status: 'DRAFT', updated_at: '2026-11-16T14:00:01.000Z' }]);
    await expect(service.saveDocuments('company', 'actor', { documents: [entry()] })).rejects.toThrow('cambió desde');
    expect(save).not.toHaveBeenCalled();
  });
  it('no permite guardar documentos ausentes de la empresa autenticada', async () => {
    const { service, save } = setup([]);
    await expect(service.saveDocuments('other-company', 'actor', { documents: [entry()] })).rejects.toThrow('no pertenece');
    expect(save).not.toHaveBeenCalled();
  });
  it.each([null, {}, { documents: [] }, { documents: [entry(), entry()] }, { documents: [{ ...entry(), id: 'invalid' }] }, { documents: [{ ...entry(), updatedAt: '' }] }, { documents: [{ ...entry(), state: null }] }])('rechaza un lote inválido sin abrir transacciones: %j', async request => {
    const { service, db } = setup();
    await expect(service.saveDocuments('company', 'actor', request)).rejects.toThrow();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
