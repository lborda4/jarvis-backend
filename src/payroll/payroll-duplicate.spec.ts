import { duplicatePayrollNovelties } from './payroll-duplicate';
import { PayrollService } from './payroll.service';
import { validatePayrollPeriod } from './payroll-period';
import type { PayrollInput } from './payroll-domain';

const employeeId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const updatedAt = '2026-11-16T14:00:00.000Z';
const state: PayrollInput = { period: '2026-01', startDate: '2026-01-01', endDate: '2026-01-15', issueDate: '2026-01-16', workedDays: '13',
  epsTypeLawDeductionsId: 4, pensionTypeLawDeductionsId: 6,
  lines: [
    { id: 'salary-old', concept: 'salary', kind: 'accrued', quantity: '13', amount: '1000000', formula: 'old formula' },
    { id: 'vacation-old', concept: 'enjoyed_vacation', kind: 'accrued', quantity: '15', amount: '100', startDate: '2026-01-01', endDate: '2026-01-15' },
    { id: 'eps-old', concept: 'eps', kind: 'deduction', quantity: '1', amount: '40000', typeLawDeductionsId: 4 },
  ] };
const request = { name: 'Nueva nómina', period: '2026-02', periodicity: 'SECOND_HALF' as const, employeeIds: [employeeId], paymentDate: '2026-03-01', duplicateSources: [{ id: sourceId, updatedAt }] };
const original = () => ({ id: sourceId, employee_id: employeeId, original_id: null, status: 'ACCEPTED', updated_at: updatedAt, state: { ...structuredClone(state), payrollGroupId: 'old-group', monthlyDocumentId: 'old-monthly' }, employee_snapshot: { salary: '1000000' }, parameter_snapshot: { concepts: [{ code: 'salary', kind: 'accrued', name: 'Salario' }] } });

describe('copia de las novedades de un período', () => {
  it('conserva importes, cantidades y deducciones, cambia las fechas e identidades y no modifica el origen', () => {
    const before = structuredClone(state);
    const copy = duplicatePayrollNovelties(state, { startDate: '2026-02-16', endDate: '2026-02-28' });
    expect(copy.workedDays).toBe('13');
    expect(copy.epsTypeLawDeductionsId).toBe(4); expect(copy.pensionTypeLawDeductionsId).toBe(6);
    expect(copy.lines[0]).toMatchObject({ amount: '1000000', quantity: '13', manual: true });
    expect(copy.lines[0].id).not.toBe(state.lines[0].id); expect(copy.lines[0]).not.toHaveProperty('formula');
    expect(copy.lines[1]).toMatchObject({ startDate: '2026-02-16', endDate: '2026-02-28', amount: '100', quantity: '15' });
    expect(copy.lines[2]).toMatchObject({ amount: '40000', typeLawDeductionsId: 4 });
    expect(copy).not.toHaveProperty('period'); expect(copy).not.toHaveProperty('monthlyDocumentId');
    expect(state).toEqual(before);
  });
  it('mantiene la duración de horas extras nocturnas al pasar de un mes largo a febrero', () => {
    const from = { ...state, startDate: '2026-01-16', endDate: '2026-01-31', lines: [{ id: 'overtime', concept: 'HEN', kind: 'accrued' as const, amount: '100', quantity: '4', startTime: '2026-01-30T22:00:00', endTime: '2026-01-31T02:00:00' }] };
    const copy = duplicatePayrollNovelties(from, { startDate: '2026-02-16', endDate: '2026-02-28' });
    expect(copy.lines[0]).toMatchObject({ startTime: '2026-02-27T22:00:00', endTime: '2026-02-28T02:00:00', quantity: '4', amount: '100' });
  });
});
function setup(sources = [original()], existing: any[] = []) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes("state->>'payrollGroupId'")) return existing;
    if (sql.startsWith('SELECT * FROM jarvis_payroll_documents')) return sources;
    if (sql.startsWith('SELECT id,data,active FROM')) return [{ id: employeeId, active: true, data: { salary: '1000000', admittanceDate: '2024-01-01' } }];
    if (sql.startsWith('SELECT data FROM jarvis_payroll_parameters')) return [{ data: { monthlyDays: '30', concepts: [{ code: 'salary', kind: 'accrued', active: true }] } }];
    return [];
  });
  const manager = { query }, db = { transaction: jest.fn((fn: any) => fn(manager)) };
  const api = { payrollRequest: jest.fn() };
  const service = new PayrollService(db as never, {} as never, api as never, {} as never);
  const save = jest.spyOn(service, 'saveDocument').mockResolvedValue({ id: 'new-document' });
  return { service, save, query, db, manager, api };
}
describe('creación de una nómina desde una copia', () => {
  it('crea un documento nuevo con los datos generales elegidos y todas las novedades de su empleado', async () => {
    const row = original(), before = structuredClone(row);
    const { service, save, query, manager, api } = setup([row]);
    const result = await service.createPeriod('company', 'actor', groupId, request);
    expect(result.documentIds).toHaveLength(1);
    const [company, actor, id, copied, tx, options] = save.mock.calls[0];
    expect(company).toBe('company'); expect(actor).toBe('actor'); expect(tx).toBe(manager);
    expect(id).not.toBe(sourceId);
    expect(copied).toMatchObject({ employeeId, payrollName: request.name, payrollGroupId: groupId, period: '2026-02', periodicity: 'SECOND_HALF', startDate: '2026-02-16', endDate: '2026-02-28', paymentDates: ['2026-03-01'], workedDays: '13', duplicatedFromDocumentId: sourceId });
    expect(copied.lines).toHaveLength(3);
    expect(copied).not.toHaveProperty('monthlyDocumentId'); expect(copied).not.toHaveProperty('originalId'); expect(copied).not.toHaveProperty('number');
    expect(options?.sourceConcepts).toEqual(row.parameter_snapshot.concepts);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE company_id=$1 AND id=ANY'), ['company', [sourceId]]);
    expect(row).toEqual(before); expect(api.payrollRequest).not.toHaveBeenCalled();
  });
  it('rechaza un origen ajeno antes de guardar empleados', async () => {
    const { service, save } = setup([]);
    await expect(service.createPeriod('other-company', 'actor', groupId, request)).rejects.toThrow('no pertenece');
    expect(save).not.toHaveBeenCalled();
  });
  it('rechaza un origen modificado después de abrir la copia', async () => {
    const { service, save } = setup([{ ...original(), updated_at: '2026-11-16T14:00:01Z' }]);
    await expect(service.createPeriod('company', 'actor', groupId, request)).rejects.toThrow('origen cambió');
    expect(save).not.toHaveBeenCalled();
  });
  it('no mezcla períodos ni permite copiar notas de ajuste', async () => {
    const row = original(); row.original_id = sourceId as never;
    const { service, save } = setup([row]);
    await expect(service.createPeriod('company', 'actor', groupId, request)).rejects.toThrow('único período');
    expect(save).not.toHaveBeenCalled();
  });
  it('permite reintentar la misma creación sin duplicar los documentos nuevos', async () => {
    const existing: any[] = [];
    const { service, save } = setup([original()], existing);
    const created = await service.createPeriod('company', 'actor', groupId, request);
    existing.push({ id: created.documentIds[0], employee_id: employeeId, state: save.mock.calls[0][3] });
    save.mockClear();
    expect((await service.createPeriod('company', 'actor', groupId, request)).documentIds).toEqual(created.documentIds);
    expect(save).not.toHaveBeenCalled();
  });
  it.each([[], [{ id: sourceId, updatedAt: '' }], [{ id: 'invalid', updatedAt }], [{ id: sourceId, updatedAt }, { id: sourceId, updatedAt }]].map(duplicateSources => ({ duplicateSources })))('valida los identificadores y versiones antes de crear: %j', ({ duplicateSources }) => {
    expect(validatePayrollPeriod({ ...request, duplicateSources })).toContain('La nómina de origen para duplicar no es válida.');
  });
});
