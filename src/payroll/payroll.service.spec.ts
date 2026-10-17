import { PayrollService } from './payroll.service';
const company = 'company-a',
  actor = 'user-a';
const state = {
  employeeId: 'employee-a',
  period: '2026-10',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  issueDate: '2026-11-01',
  workedDays: '30',
  lines: [
    {
      id: 'salary',
      concept: 'salary',
      kind: 'accrued',
      amount: '1000',
      quantity: '30',
    },
  ],
};
const worker = {
  id: 'employee-a',
  identification: '12345678',
  firstName: 'Ana',
  surname: 'Pérez',
  salary: '1000',
  admittanceDate: '2026-01-01',
  typeWorkerId: 1,
  subTypeWorkerId: 1,
  documentTypeId: 3,
  paymentMethodId: 1,
  active: true,
};
const document = {
  id: 'document-a',
  company_id: company,
  employee_id: 'employee-a',
  state,
  employee_snapshot: worker,
  parameter_snapshot: { concepts: [{ code: 'salary', kind: 'accrued' }] },
  status: 'DRAFT',
  number: null,
};
function build(overrides: any = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT * FROM jarvis_payroll_documents'))
      return [{ ...document, ...overrides }];
    if (sql.startsWith('SELECT * FROM jarvis_payroll_settings'))
      return [
        {
          settings: {
            enabled: true,
            environment: 2,
            syncedEnvironment: 2,
            prefix: 'NE',
          },
          next_number: '1',
        },
      ];
    if (sql.startsWith('SELECT active FROM')) return [{ active: true }];
    return [];
  });
  const db = {
    query,
    transaction: jest.fn(async (fn: any) => fn({ query })),
    manager: { query },
  };
  const api = {
    payrollPlanInfo: jest.fn().mockResolvedValue({ docs_left_absolut: 100 }),
    payrollRequest: jest.fn().mockResolvedValue({
      success: true,
      ResponseDian: { IsValid: 'true' },
      cune: 'a'.repeat(96),
    }),
    payrollStatus: jest.fn(),
  };
  const plans = {
    withJarvisQuotaLock: jest.fn(async (_c: string, fn: any) => fn()),
    assertCanCreateDocuments: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PayrollService(
    db as any,
    {
      requireCompanyToken: jest.fn().mockResolvedValue('private-token'),
      getPayrollWorkerCatalogs: jest.fn().mockResolvedValue({
        workerTypes: [{ id: 1 }],
        workerSubtypes: [{ id: 1 }],
        identifications: [{ id: 3 }],
        paymentMethods: [{ id: 1 }],
      }),
    } as any,
    api as any,
    plans as any,
  );
  return { service, db, query, api, plans };
}
describe('nómina: persistencia y transmisión', () => {
  it('una consulta negativa no habilita otro envío de una nómina incierta', async () => {
    const { service, query, api } = build({
      status: 'UNCERTAIN',
      cune: 'a'.repeat(96),
    });
    api.payrollStatus.mockResolvedValue({ ResponseDian: { IsValid: 'false' } });
    await service.refreshStatus(company, actor, 'document-a');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET status=$3,updated_at'),
      [company, 'document-a', 'UNCERTAIN'],
    );
  });
  it('una consulta positiva confirma la aceptación pendiente', async () => {
    const { service, query, api } = build({
      status: 'UNCERTAIN',
      cune: 'a'.repeat(96),
    });
    api.payrollStatus.mockResolvedValue({ ResponseDian: { IsValid: 'true' } });
    await service.refreshStatus(company, actor, 'document-a');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET status=$3,updated_at'),
      [company, 'document-a', 'ACCEPTED'],
    );
  });
  it('rechaza tipos de trabajador fuera del catálogo real', async () => {
    const { service } = build();
    await expect(
      service.saveEmployee(company, actor, 'employee-a', {
        ...worker,
        contractType: 'INDEFINITE',
        typeWorkerId: 999,
      }),
    ).rejects.toThrow('catálogo');
  });
  it('rechaza métodos de pago fuera del catálogo real', async () => {
    const { service } = build();
    await expect(
      service.saveEmployee(company, actor, 'employee-a', {
        ...worker,
        contractType: 'INDEFINITE',
        paymentMethodId: 999,
      }),
    ).rejects.toThrow('método de pago');
  });
  it('no revierte una aceptación si falla la lectura posterior', async () => {
    const { service, query } = build();
    jest.spyOn(service, 'get').mockRejectedValue(new Error('read failed'));
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow(
      'read failed',
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("status='UNCERTAIN'"),
      [company, 'document-a'],
    );
  });
  it('aísla cada consulta de documento por empresa', async () => {
    const { service, query } = build();
    await service.get(company, 'document-a');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('company_id=$1 AND id=$2'),
      [company, 'document-a'],
    );
  });
  it.each(['ACCEPTED', 'PROCESSING', 'UNCERTAIN'])(
    'no reenvía estado %s',
    async (status) => {
      const { service, api } = build({ status });
      await expect(
        service.send(company, actor, 'document-a'),
      ).rejects.toThrow();
      expect(api.payrollRequest).not.toHaveBeenCalled();
    },
  );
  it('no transmite sin cupo de proveedor', async () => {
    const { service, api } = build();
    api.payrollPlanInfo.mockResolvedValue({ docs_left_absolut: 0 });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow(
      'disponibles',
    );
    expect(api.payrollRequest).not.toHaveBeenCalled();
  });
  it('reutiliza el plan existente y su bloqueo de concurrencia', async () => {
    const { service, plans } = build();
    await service.send(company, actor, 'document-a');
    expect(plans.withJarvisQuotaLock).toHaveBeenCalledWith(
      company,
      expect.any(Function),
    );
    expect(plans.assertCanCreateDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: company,
        provider: 'JARVIS',
        quantity: 1,
      }),
    );
  });
  it('persiste la solicitud antes de llamar al proveedor', async () => {
    const { service, query, api } = build();
    await service.send(company, actor, 'document-a');
    const insert = query.mock.calls.findIndex(([sql]) =>
      sql.startsWith('INSERT INTO jarvis_payroll_transmissions'),
    );
    expect(insert).toBeGreaterThan(-1);
    expect(query.mock.invocationCallOrder[insert]).toBeLessThan(
      api.payrollRequest.mock.invocationCallOrder[0],
    );
  });
  it('no acepta solamente por HTTP exitoso', async () => {
    const { service, query, api } = build();
    api.payrollRequest.mockResolvedValue({ success: true } as any);
    await service.send(company, actor, 'document-a');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('status=$3,cune=$4'),
      [company, 'document-a', 'UNCERTAIN', null],
    );
  });
  it('reconoce rechazo DIAN aunque success sea true', async () => {
    const { service, query, api } = build();
    api.payrollRequest.mockResolvedValue({
      success: true,
      ResponseDian: { IsValid: 'false' },
    } as any);
    await service.send(company, actor, 'document-a');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('status=$3,cune=$4'),
      [company, 'document-a', 'REJECTED', null],
    );
  });
  it('reserva un envío ambiguo y no reintenta automáticamente', async () => {
    const { service, query, api } = build();
    api.payrollRequest.mockRejectedValue(new Error('timeout'));
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow(
      'No se confirmó',
    );
    expect(api.payrollRequest).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status='UNCERTAIN'"),
      [company, 'document-a'],
    );
  });
  it('impide modificar una nómina aceptada', async () => {
    const { service } = build({ status: 'ACCEPTED' });
    await expect(
      service.saveDocument(company, actor, 'document-a', state),
    ).rejects.toThrow('cambios directos');
  });
  it('no transmite conceptos sin mapeo', async () => {
    const { service, api } = build({
      state: {
        ...state,
        lines: [{ ...state.lines[0], concept: 'disability' }],
      },
    });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow(
      'integración',
    );
    expect(api.payrollRequest).not.toHaveBeenCalled();
  });
});
