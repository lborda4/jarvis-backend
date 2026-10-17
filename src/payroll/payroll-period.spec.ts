import { PayrollService } from './payroll.service';
const employeeIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const request = {
  name: '  Administración octubre  ',
  period: '2026-10',
  periodicity: 'FIRST_HALF' as const,
  employeeIds,
};
const groupId = '33333333-3333-4333-8333-333333333333';
function build(
  existing: any[] = [],
  employees = employeeIds.map((id) => ({
    id,
    active: true,
    data: { salary: '2000000' },
  })),
) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes("state->>'payrollGroupId'")) return existing;
    if (sql.startsWith('SELECT id,data,active FROM')) return employees;
    if (sql.startsWith('SELECT data FROM jarvis_payroll_parameters'))
      return [
        {
          data: {
            monthlyDays: '30',
            concepts: [{ code: 'salary', kind: 'accrued', active: true }],
          },
        },
      ];
    return [];
  });
  const manager = { query };
  const db = { transaction: jest.fn((work: any) => work(manager)) };
  const api = { payrollRequest: jest.fn() };
  const plans = { assertCanCreateDocuments: jest.fn() };
  const service = new PayrollService(
    db as any,
    {} as any,
    api as any,
    plans as any,
  );
  const save = jest
    .spyOn(service, 'saveDocument')
    .mockResolvedValue({ id: 'saved' });
  return { service, query, manager, db, api, plans, save };
}
describe('creación conjunta de nómina', () => {
  it('crea un borrador por empleado en la misma transacción sin enviar ni descontar cupos', async () => {
    const { service, save, manager, api, plans, db } = build();
    const result = await service.createPeriod(
      'company',
      'actor',
      groupId,
      request,
    );
    expect(result.documentIds).toHaveLength(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    for (const [company, actor, id, state, tx] of save.mock.calls) {
      expect(company).toBe('company');
      expect(actor).toBe('actor');
      expect(id).toBeTruthy();
      expect(tx).toBe(manager);
      expect(state).toMatchObject({
        payrollName: 'Administración octubre',
        payrollGroupId: groupId,
        periodicity: 'FIRST_HALF',
        startDate: '2026-10-01',
        endDate: '2026-10-15',
        workedDays: '15.00',
      });
      expect(state.lines[0].amount).toBe('1000000.00');
    }
    expect(api.payrollRequest).not.toHaveBeenCalled();
    expect(plans.assertCanCreateDocuments).not.toHaveBeenCalled();
  });
  it('no duplica documentos al repetir una solicitud ya creada', async () => {
    const existing = employeeIds.map((employee_id, i) => ({
      id: `document-${i}`,
      employee_id,
      state: {
        payrollName: request.name.trim(),
        period: request.period,
        periodicity: request.periodicity,
      },
    }));
    const { service, save } = build(existing);
    expect(
      (await service.createPeriod('company', 'actor', groupId, request))
        .documentIds,
    ).toEqual(['document-0', 'document-1']);
    expect(save).not.toHaveBeenCalled();
  });
  it('rechaza reutilizar el identificador con otra selección', async () => {
    const { service, save } = build([
      { id: 'doc', employee_id: employeeIds[0], state: {} },
    ]);
    await expect(
      service.createPeriod('company', 'actor', groupId, request),
    ).rejects.toThrow('otra información');
    expect(save).not.toHaveBeenCalled();
  });
  it('rechaza empleados que no pertenecen a la empresa o están inactivos', async () => {
    const { service, save } = build([], []);
    await expect(
      service.createPeriod('company', 'actor', groupId, request),
    ).rejects.toThrow('activos de esta empresa');
    expect(save).not.toHaveBeenCalled();
  });
  it('propaga el error de un empleado para revertir toda la creación', async () => {
    const { service, save } = build();
    save
      .mockResolvedValueOnce({ id: 'first' })
      .mockRejectedValueOnce(new Error('Empleado inválido'));
    await expect(
      service.createPeriod('company', 'actor', groupId, request),
    ).rejects.toThrow('Empleado inválido');
  });
});
