import { PayrollService } from './payroll.service';
import { Logger } from '@nestjs/common';
const company = 'company-a',
  actor = 'user-a';
const state = {
  employeeId: 'employee-a',
  period: '2026-10',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  issueDate: '2026-11-01',
  workedDays: '30',
  payrollPeriodId: 4,
  paymentDates: ['2026-10-31'],
  lines: [
    {
      id: 'salary',
      concept: 'salary',
      kind: 'accrued',
      amount: '1000',
      quantity: '30',
    },
    { id: 'eps-required', concept: 'eps', kind: 'deduction', quantity: '1', amount: '0', typeLawDeductionsId: 31 },
    { id: 'pension-required', concept: 'pension', kind: 'deduction', quantity: '1', amount: '0', typeLawDeductionsId: 51 },
  ],
};
const worker = {
  id: 'employee-a',
  workerCode: 'EMP001',
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
  address: 'Calle 1',
  municipalityId: 439,
  typeContractId: 1,
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
            enabled: false,
            environment: 2,
            syncedEnvironment: 2,
            prefix: 'NI',
          },
          next_number: '1',
          next_note_number: '1',
        },
      ];
    if (sql.startsWith('SELECT nit FROM companies')) return [{ nit: '900123456' }];
    if (sql.startsWith('SELECT data,active FROM')) return [{ data: worker, active: true }];
    return [];
  });
  const db = {
    query,
    transaction: jest.fn(async (fn: any) => fn({ query })),
    manager: { query },
  };
  const api = {
    getPayrollIssuerConfiguration: jest.fn().mockResolvedValue({ identificationNumber: '900123456', payrollEnvironment: 1, payrollSoftwareConfigured: true, payrollPinConfigured: true }),
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
      getPayrollLawDeductions: jest.fn().mockResolvedValue([{ id: 31, name: 'Salud' }, { id: 51, name: 'Pension' }, { id: 91, code: '9', name: 'Fondo de Solidaridad' }]),
      getPayrollDisabilityTypes: jest.fn().mockResolvedValue([{ id: 17, code: '03', name: 'Profesional' }]),
      getPayrollOvertimeSurcharges: jest.fn().mockResolvedValue([{ id: 19, name: 'Hora Extra Diurna', code: '1' }]),
      getPayrollWorkerCatalogs: jest.fn().mockResolvedValue({
        workerTypes: [{ id: 1 }],
        contractTypes: [{ key: 'INDEFINITE', id: 1, name: 'Término indefinido', code: '2' }],
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
  it.each([false, undefined])('envía sin exigir el indicador enabled=%s', async enabled => {
    const { service, api, query } = build();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT * FROM jarvis_payroll_settings')
      ? [{ settings: { enabled, environment: 2, syncedEnvironment: 2, prefix: 'NI' }, next_number: '1' }]
      : original(sql));
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledTimes(1);
  });

  it('no reporta transmisión deshabilitada al validar una nómina', async () => {
    const { service } = build();
    jest.spyOn(service, 'bootstrap').mockResolvedValue({ settings: { enabled: false }, employees: [worker] } as never);
    await expect(service.validate(company, 'document-a')).resolves.toEqual({ errors: [], valid: true });
  });

  it.each([undefined, 1])('envía sin sincronizar ni modificar el ambiente de nómina (marca=%s)', async syncedEnvironment => {
    const { service, api, query } = build();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT * FROM jarvis_payroll_settings')
      ? [{ settings: { environment: 2, syncedEnvironment, prefix: 'NI' }, next_number: '1' }]
      : original(sql));
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledTimes(1);
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.anything(), 'private-token');
  });

  it('envía el cuerpo de nómina a NextPyme con el token de la empresa', async () => {
    const { service, api, query } = build();
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({
      type_document_id: 9, consecutive: 1, prefix: 'NI', payroll_period_id: 4,
      novelty: { novelty: false, uuidnov: '' },
      accrued: { salary: '1000.00', worked_days: 30, accrued_total: '1000.00' },
      deductions: { deductions_total: '0.00', eps_type_law_deductions_id: 4, eps_deduction: '0.00', pension_type_law_deductions_id: 6, pension_deduction: '0.00' },
      worker: expect.objectContaining({ municipality_id: 439, type_contract_id: 1 }),
      payment_dates: [{ payment_date: '2026-10-31' }],
    }), 'private-token');
    const saved = query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO jarvis_payroll_transmissions')) as any;
    expect(JSON.parse(saved[1][3])).toEqual(api.payrollRequest.mock.calls[0][1]);
  });
  it('conserva prefijo y consecutivo de un documento rechazado sin consumir otro número', async () => {
    const { service, api, query } = build({ status: 'REJECTED', number: '27', prefix: 'NE' });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ prefix: 'NE', consecutive: 27 }), 'private-token');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE jarvis_payroll_settings SET next_number=next_number+1'))).toBe(false);
  });
  it('reintenta con NI una nómina rechazada con SETP y sin CUNE, conservando el consecutivo', async () => {
    const { service, api, query } = build({ status: 'REJECTED', number: '27', prefix: 'SETP', cune: null });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ prefix: 'NI', consecutive: 27 }), 'private-token');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status='PROCESSING',number=$3,prefix=$4"), [company, 'document-a', '27', 'NI']);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE jarvis_payroll_settings SET next_number=next_number+1'))).toBe(false);
  });
  it('conserva el prefijo histórico SETP de una nómina que ya tiene CUNE', async () => {
    const { service, api } = build({ status: 'REJECTED', number: '27', prefix: 'SETP', cune: 'a'.repeat(96) });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ prefix: 'SETP', consecutive: 27 }), 'private-token');
  });
  it('una nómina nueva toma el contador guardado y no un número enviado en el estado', async () => {
    const { service, api, query } = build({ state: { ...state, prefix: 'USUARIO', consecutive: 1 } });
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT * FROM jarvis_payroll_settings')
      ? [{ settings: { enabled: true, environment: 2, syncedEnvironment: 2, prefix: 'NI' }, next_number: '38' }]
      : original(sql));
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ prefix: 'NI', consecutive: 38 }), 'private-token');
    expect(query).toHaveBeenCalledWith('UPDATE jarvis_payroll_settings SET next_number=next_number+1 WHERE company_id=$1', [company]);
  });
  it('una consulta negativa no habilita otro envío de una nómina incierta', async () => {
    const { service, query, api } = build({
      status: 'UNCERTAIN',
      cune: 'a'.repeat(96),
    });
    api.payrollStatus.mockResolvedValue({ ResponseDian: { IsValid: 'false' } });
    await service.refreshStatus(company, actor, 'document-a');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET status=$3,cune=COALESCE(cune,$4),updated_at'),
      [company, 'document-a', 'UNCERTAIN', 'a'.repeat(96)],
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
      expect.stringContaining('SET status=$3,cune=COALESCE(cune,$4),updated_at'),
      [company, 'document-a', 'ACCEPTED', 'a'.repeat(96)],
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
      [company, 'document-a', null],
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
  it('reserva un rechazo DIAN de documento previamente procesado y conserva su CUNE', async () => {
    const { service, query, api } = build();
    const cune = 'a'.repeat(96);
    api.payrollRequest.mockResolvedValue({ success: false, ResponseDian: { IsValid: 'false', ErrorMessage: { string: [`Regla: 90, Documento procesado anteriormente. CUNE ${cune}`] } } } as never);
    await service.send(company, actor, 'document-a');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('status=$3,cune=$4'), [company, 'document-a', 'UNCERTAIN', cune]);
  });
  it('no reenvía un rechazo histórico cuyo proveedor indicó que ya fue procesado', async () => {
    const { service, query, api } = build({ status: 'REJECTED', number: '1' });
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT response,validation,error FROM jarvis_payroll_transmissions')
      ? [{ response: { message: 'Regla: 90, Documento procesado anteriormente' } }] : original(sql));
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('pendiente de confirmación');
    expect(api.payrollRequest).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO jarvis_payroll_transmissions'))).toBe(false);
  });
  it('permite consultar el CUNE de un rechazo histórico duplicado sin marcarlo como rechazo confirmado', async () => {
    const cune = 'b'.repeat(96);
    const { service, query, api } = build({ status: 'REJECTED', number: '1', cune: null });
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT id,request,response,validation,error,created_at FROM jarvis_payroll_transmissions')
      ? [{ response: { ResponseDian: { ErrorMessage: { string: [`Regla: 90, Documento procesado anteriormente. CUNE ${cune}`] } } } }]
      : original(sql));
    expect(await service.get(company, 'document-a')).toMatchObject({ status: 'UNCERTAIN', cune });
    api.payrollStatus.mockResolvedValue({ ResponseDian: { IsValid: 'false' } });
    await service.refreshStatus(company, actor, 'document-a');
    expect(api.payrollStatus).toHaveBeenCalledWith(cune, 'private-token');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET status=$3,cune=COALESCE(cune,$4)'), [company, 'document-a', 'UNCERTAIN', cune]);
  });
  it('recupera CUNE de una transmisión antigua en estado incierto', async () => {
    const cune = 'c'.repeat(96);
    const { service, query, api } = build({ status: 'UNCERTAIN', cune: null });
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT id,request,response,validation,error,created_at FROM jarvis_payroll_transmissions')
      ? [{ response: { message: `Documento procesado anteriormente. CUNE ${cune}` } }] : original(sql));
    api.payrollStatus.mockResolvedValue({ ResponseDian: { IsValid: 'true' } });
    await service.refreshStatus(company, actor, 'document-a');
    expect(api.payrollStatus).toHaveBeenCalledWith(cune, 'private-token');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET status=$3,cune=COALESCE(cune,$4)'), [company, 'document-a', 'ACCEPTED', cune]);
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
      [company, 'document-a', null],
    );
  });
  it('impide modificar una nómina aceptada', async () => {
    const { service } = build({ status: 'ACCEPTED' });
    await expect(
      service.saveDocument(company, actor, 'document-a', state),
    ).rejects.toThrow('cambios directos');
  });
  it('transmite conceptos sin mapeo para que NextPyme los valide', async () => {
    const { service, api } = build({
      state: {
        ...state,
        lines: [{ ...state.lines[0], concept: 'unsupported_concept' }, ...state.lines.slice(1)],
      },
    });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ accrued: expect.objectContaining({ unsupported_concept: '1000.00', accrued_total: '1000.00' }) }), 'private-token');
  });
  it('guarda los cambios del editor para enviar sin validación de campos, conservando la validación normal del borrador', async () => {
    const { service, query } = build();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM jarvis_payroll_parameters')) return [{ data: document.parameter_snapshot }];
      if (sql.startsWith('INSERT INTO jarvis_payroll_documents')) return [{ id: 'document-a' }];
      return original(sql);
    });
    const edited = { ...state, workedDays: '0', lines: [{ ...state.lines[0], concept: 'unsupported_concept' }] };
    await expect(service.saveDocument(company, actor, 'document-a', edited, undefined, { validation: 'provider' })).resolves.toEqual({ id: 'document-a' });
    const saved = query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO jarvis_payroll_documents')) as any;
    expect(JSON.parse(saved[1][4])).toMatchObject({ workedDays: '0', lines: [{ concept: 'unsupported_concept' }] });
    await expect(service.saveDocument(company, actor, 'document-a', edited)).rejects.toThrow('días trabajados');
  });
});

describe('código persistido del empleado al transmitir', () => {
  it('envía el código de la ficha aunque el borrador anterior no lo tenga', async () => {
    const legacySnapshot = { ...worker };
    delete (legacySnapshot as { workerCode?: string }).workerCode;
    const { service, api, query } = build({ employee_snapshot: legacySnapshot });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ worker_code: 'EMP001', worker: expect.objectContaining({ identification_number: '12345678' }) }), 'private-token');
    const saved = query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO jarvis_payroll_transmissions')) as any;
    expect(JSON.parse(saved[1][3]).worker_code).toBe('EMP001');
    expect(legacySnapshot).not.toHaveProperty('workerCode');
  });
  it('usa el código del empleado guardado y conserva el salario histórico del borrador', async () => {
    const { service, api } = build({ employee_snapshot: { ...worker, workerCode: 'CODIGO-OBSOLETO', salary: '900' } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ worker_code: 'EMP001', worker: expect.objectContaining({ salary: '900.00' }) }), 'private-token');
  });
});

describe('estado del empleado según fecha de retiro', () => {
  it('guarda activo al empleado sin retiro aunque llegue un indicador antiguo en false', async () => {
    const { service, query } = build();
    query.mockImplementation(async (sql: string) => sql.includes('INSERT INTO jarvis_payroll_employees') ? [{ id: 'employee-a' }] : []);
    await service.saveEmployee(company, actor, 'employee-a', { ...worker, contractType: 'INDEFINITE', active: false });
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO jarvis_payroll_employees')) as any;
    expect(insert[1][4]).toBe(true);
    expect(JSON.parse(insert[1][3]).active).toBe(true);
  });
  it('guarda inactivo al empleado cuando su retiro ya pasó', async () => {
    const { service, query } = build();
    query.mockImplementation(async (sql: string) => sql.includes('INSERT INTO jarvis_payroll_employees') ? [{ id: 'employee-a' }] : []);
    await service.saveEmployee(company, actor, 'employee-a', { ...worker, contractType: 'INDEFINITE', retirementDate: '2026-02-01', active: true });
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO jarvis_payroll_employees')) as any;
    expect(insert[1][4]).toBe(false);
    expect(JSON.parse(insert[1][3]).active).toBe(false);
  });
  it('corrige la lectura de registros sin retiro que tenían la marca antigua de inactivo', async () => {
    const { service, query } = build();
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT id, data, active FROM jarvis_payroll_employees') ? [{ id: 'employee-a', data: worker, active: false }] : []);
    const result = await service.bootstrap(company);
    expect(result.employees[0].active).toBe(true);
  });
});

describe('envío de horas extra diurnas con catálogo', () => {
  const overtime = { id: 'hed', concept: 'overtime_day', kind: 'accrued', quantity: '2.5', amount: '100', startTime: '2026-10-08T17:00:00', endTime: '2026-10-08T19:30:00', overtimeSurchargeId: 19 };
  it('incluye HEDs con el ID de la empresa al transmitir', async () => {
    const { service, api } = build({ state: { ...state, lines: [...state.lines, overtime] } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ accrued: expect.objectContaining({ HEDs: [expect.objectContaining({ quantity: 2.5, percentage: 19, payment: '100.00' })] }) }), 'private-token');
  });
  it('envía el ID del recargo para que NextPyme lo valide', async () => {
    const { service, api } = build({ state: { ...state, lines: [...state.lines, { ...overtime, overtimeSurchargeId: 25 }] } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ accrued: expect.objectContaining({ HEDs: [expect.objectContaining({ percentage: 25 })] }) }), 'private-token');
  });
});

describe('envío de incapacidades con catálogo', () => {
  const disability = { id: 'disability', concept: 'disability', kind: 'accrued', quantity: '3', amount: '100', startDate: '2026-10-08', endDate: '2026-10-10', type: 17 };
  it('envía el ID seleccionado de la tabla maestra, conservando el importe', async () => {
    const { service, api } = build({ state: { ...state, lines: [...state.lines, disability] } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ accrued: expect.objectContaining({ work_disabilities: [{ start_date: '2026-10-08', end_date: '2026-10-10', quantity: 3, type: 17, payment: '100.00' }] }) }), 'private-token');
  });
  it('envía el tipo de incapacidad para que NextPyme lo valide', async () => {
    const { service, api } = build({ state: { ...state, lines: [...state.lines, { ...disability, type: 3 }] } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ accrued: expect.objectContaining({ work_disabilities: [expect.objectContaining({ type: 3 })] }) }), 'private-token');
  });
});

describe('validación de deducciones contra catálogo', () => {
  const line = { id: 'fund', concept: 'solidarity', kind: 'deduction', quantity: '1', amount: '10.25', typeLawDeductionsId: 91 };
  it('transmite solidaridad con el ID de NextPyme', async () => {
    const { service, api } = build({ state: { ...state, lines: [...state.lines, line] } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ deductions: expect.objectContaining({ fondossp_type_law_deductions_id: 9, fondosp_deduction_SP: '10.25' }) }), 'private-token');
  });
  it('normaliza el ID de solidaridad antes del envío', async () => {
    const { service, api } = build({ state: { ...state, lines: [...state.lines, { ...line, typeLawDeductionsId: 999 }] } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ deductions: expect.objectContaining({ fondossp_type_law_deductions_id: 9 }) }), 'private-token');
  });
});

it('transmite las tres deducciones estructuradas sin perder valores', async () => {
  const lines = [...state.lines,
    { id: 'union', concept: 'labor_union', kind: 'deduction', quantity: '1', amount: '10', percentage: '2' },
    { id: 'sanction', concept: 'sanctions', kind: 'deduction', quantity: '1', amount: '20', privateSanction: '20' },
    { id: 'loan', concept: 'loan', kind: 'deduction', quantity: '1', amount: '30', description: 'Cuota de libranza' },
  ];
  const { service, api } = build({ state: { ...state, lines } });
  await service.send(company, actor, 'document-a');
  expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ deductions: { eps_type_law_deductions_id: 4, eps_deduction: '0.00', pension_type_law_deductions_id: 6, pension_deduction: '0.00', deductions_total: '60.00', labor_union: [{ percentage: 2, deduction: 10 }], sanctions: [{ private_sanction: 20 }], orders: [{ description: 'Cuota de libranza', deduction: 30 }] } }), 'private-token');
});

it('transmite pagos a terceros, anticipos, otras deducciones y escalares con total calculado', async () => {
  const keys = ['third_party_payment_deduction', 'advance', 'other_deduction', 'voluntary', 'withholding', 'afc', 'cooperative', 'garnishment', 'supplementary_plan', 'education', 'refund_deduction', 'debt'];
  const lines = keys.map(concept => ({ id: concept, concept, kind: 'deduction', quantity: '1', amount: '10.25' }));
  const { service, api } = build({ state: { ...state, lines: [...state.lines, ...lines] } });
  await service.send(company, actor, 'document-a');
  expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ deductions: expect.objectContaining({ deductions_total: '123.00', voluntary_pension: 10.25, tax_liens: 10.25, debt: 10.25, advances: [{ advance: 10.25 }], other_deductions: [{ other_deduction: 10.25 }] }) }), 'private-token');
});

describe('separación de tipos de deducción de ley', () => {
  it.each([['eps', 51], ['pension', 31], ['solidarity', 31], ['subsistence', 51]])('envía %s con el ID seleccionado para validación del proveedor: %s', async (concept, typeLawDeductionsId) => {
    const line = { id: 'wrong', concept, typeLawDeductionsId, kind: 'deduction', quantity: '1', amount: '10' };
    const { service, api } = build({ state: { ...state, lines: [...state.lines, line] } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledTimes(1);
  });
  it.each([['eps', 31], ['pension', 51], ['solidarity', 91], ['subsistence', 91]])('permite %s con el ID de su grupo: %s', async (concept, typeLawDeductionsId) => {
    const line = { id: 'correct', concept, typeLawDeductionsId, kind: 'deduction', quantity: '1', amount: '10' };
    const { service, api } = build({ state: { ...state, lines: [...state.lines, line] } });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledTimes(1);
  });
});

describe('logs de fallos de nómina', () => {
  let errors: jest.SpyInstance;
  let logs: jest.SpyInstance;
  beforeEach(() => {
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => { errors.mockRestore(); logs.mockRestore(); });

  it('registra el inicio y el motivo de falta de cupo aunque nunca haga el POST', async () => {
    const { service, api } = build();
    api.payrollPlanInfo.mockResolvedValue({ docs_left_absolut: 0 });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('disponibles');
    expect(logs).toHaveBeenCalledWith(expect.stringContaining('[payroll] PREPARE'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"stage":"PROVIDER_PLAN"'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('No hay documentos disponibles'));
    expect(api.payrollRequest).not.toHaveBeenCalled();
  });

  it('actualiza los campos del empleado y registra el rechazo devuelto por NextPyme', async () => {
    const { service, api, query } = build({ employee_snapshot: { ...worker, address: '', municipalityId: undefined, typeContractId: undefined },
      state: { ...state, lines: [...state.lines, { id: 'custom', concept: 'internal_bonus', kind: 'accrued', quantity: '1', amount: '100' }] } });
    api.payrollRequest.mockRejectedValue({ isAxiosError: true, response: { status: 422, data: { errors: { worker: ['Dirección requerida por NextPyme'] } } } });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('Dirección requerida por NextPyme');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"stage":"PROVIDER_REQUEST"'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"employee":"employee-a"'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"month":"2026-10"'));
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll', expect.objectContaining({ worker: expect.objectContaining({ address: 'Calle 1', municipality_id: 439, type_contract_id: 1 }), accrued: expect.objectContaining({ internal_bonus: '100.00', accrued_total: '1100.00' }) }), 'private-token');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='REJECTED'"), [company, 'document-a', null]);
  });

  it('registra un rechazo de DIAN aun cuando el proveedor resuelve la petición HTTP', async () => {
    const { service, api } = build();
    api.payrollRequest.mockResolvedValue({ success: true, ResponseDian: { IsValid: 'false', ErrorMessage: { string: ['Regla: EPS inválida'] } } } as any);
    await service.send(company, actor, 'document-a');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"stage":"REJECTED"'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Regla: EPS inválida'));
    expect(logs).not.toHaveBeenCalledWith(expect.stringContaining('[payroll] ACCEPTED'));
  });

  it('registra HTTP, motivo y etapa de un fallo del proveedor ocultando sus credenciales', async () => {
    const { service, api } = build();
    api.payrollRequest.mockRejectedValue({ isAxiosError: true, response: { status: 422, data: { message: 'Dato inválido private-token', token: 'private-token' } }, config: { headers: { Authorization: 'Bearer private-token' } } });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('Dato inválido');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"httpStatus":422'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"stage":"PROVIDER_REQUEST"'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Dato inválido [REDACTED]'));
    expect(JSON.stringify(errors.mock.calls)).not.toContain('private-token');
  });

  it('registra el error de conexión al consultar el plan sin emitir una nómina', async () => {
    const { service, api } = build();
    api.payrollPlanInfo.mockRejectedValue({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout', config: { headers: { Authorization: 'Bearer private-token' } } });
    await expect(service.send(company, actor, 'document-a')).rejects.toBeDefined();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"code":"ECONNABORTED"'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"stage":"PROVIDER_PLAN"'));
    expect(api.payrollRequest).not.toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain('private-token');
  });

  it('conserva el fallo original y lo registra aunque no pueda guardar el historial del error', async () => {
    const { service, api, db } = build();
    api.payrollPlanInfo.mockResolvedValue({ docs_left_absolut: 0 });
    db.transaction.mockRejectedValueOnce(new Error('database disconnected'));
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('disponibles');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"stage":"PROVIDER_PLAN"'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"stage":"SAVE_PREPARATION_ERROR"'));
  });

  it('registra aceptación y no imprime un error cuando DIAN acepta', async () => {
    const { service } = build();
    await service.send(company, actor, 'document-a');
    expect(logs).toHaveBeenCalledWith(expect.stringContaining('[payroll] ACCEPTED'));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('errores visibles del envío de nómina', () => {
  it('guarda un error de preparación sin llamar al servicio de emisión', async () => {
    const { service, api, query } = build();
    api.payrollPlanInfo.mockResolvedValue({ docs_left_absolut: 0 });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('disponibles');
    expect(api.payrollRequest).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='REJECTED'"), [company, 'document-a']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('request,error,completed_at'), expect.arrayContaining([JSON.stringify({ operation: 'PREPARE' }), expect.stringContaining('disponibles')]));
  });
  it('guarda los errores de campos de un HTTP 422 y permite corregir el documento', async () => {
    const { service, api, query } = build();
    api.payrollRequest.mockRejectedValue({ isAxiosError: true, response: { status: 422, data: { errors: { worker: ['Falta código'], eps: ['Revisa EPS'] }, token: 'private-token' } } });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('Falta código');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='REJECTED'"), [company, 'document-a', null]);
    const stored = query.mock.calls.find(([sql]) => sql.includes('response=$3,error=$4')) as any;
    expect(stored[1][3]).toBe('Falta código | Revisa EPS');
    expect(stored[1][2]).not.toContain('private-token');
    expect(api.payrollRequest).toHaveBeenCalledTimes(1);
  });
  it.each([500, 409])('mantiene reservado un envío de resultado ambiguo HTTP %s', async status => {
    const { service, api, query } = build();
    api.payrollRequest.mockRejectedValue({ isAxiosError: true, response: { status, data: { message: 'No confirmado' } } });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('No se confirmó');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='UNCERTAIN'"), [company, 'document-a', null]);
  });
  it('no habilita reenvío cuando un HTTP 422 informa documento ya procesado', async () => {
    const { service, api, query } = build();
    api.payrollRequest.mockRejectedValue({ isAxiosError: true, response: { status: 422, data: { message: 'Regla: 90, Documento procesado anteriormente.' } } });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('No se confirmó');
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='UNCERTAIN'"), [company, 'document-a', null]);
  });
  it('trata success false como error aunque el HTTP haya sido exitoso', async () => {
    const { service, api, query } = build();
    api.payrollRequest.mockResolvedValue({ success: false, errors: { period: ['Período inválido'] } } as any);
    await service.send(company, actor, 'document-a');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('status=$3,cune=$4'), [company, 'document-a', 'REJECTED', null]);
  });
  it('lista los avisos sin devolver el cuerpo técnico completo y sin marcar borradores nuevos', async () => {
    const { service, query } = build();
    query.mockResolvedValue([
      { id: 'a', status: 'REJECTED', lastResult: { response: { errors: { eps: ['Revisa EPS'] } } } },
      { id: 'b', status: 'DRAFT', lastResult: null },
      { id: 'c', status: 'UNCERTAIN', lastResult: null },
    ] as any);
    const result = await service.list(company);
    expect(result[0].submissionErrors).toEqual(['Revisa EPS']);
    expect(result[0]).not.toHaveProperty('lastResult');
    expect(result[1].submissionErrors).toEqual([]);
    expect(result[2].submissionErrors[0]).toContain('antes de reenviar');
  });
});

describe('datos actuales del empleado al transmitir una nómina histórica', () => {
  it('envía ciudad, dirección, contrato y efectivo corregidos sin cambiar el salario histórico ni exigir banco', async () => {
    const { service, query, api } = build({ employee_snapshot: { ...worker, address: undefined, municipalityId: undefined,
      typeContractId: undefined, paymentMethodId: 30, salary: '777', bankName: 'Banco antiguo' } });
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT data,active FROM')
      ? [{ data: { ...worker, address: 'Calle corregida', municipalityId: 149, contractType: 'INDEFINITE', typeContractId: undefined,
        paymentMethodId: 100, paymentMethodType: 'transfer', salary: '9999' }, active: true }] : original(sql));
    (service as any).catalogs.getPayrollWorkerCatalogs.mockResolvedValue({
      paymentMethods: [{ id: 100, name: 'Efectivo', code: '10' }], contractTypes: [{ key: 'INDEFINITE', id: 77 }],
    });
    await service.send(company, actor, 'document-a');
    const body = api.payrollRequest.mock.calls[0][1] as any;
    expect(body.worker).toMatchObject({ address: 'Calle corregida', municipality_id: 149, type_contract_id: 77, salary: '777.00' });
    expect(body.payment).toEqual({ payment_method_id: 100 });
    expect(body.deductions).toMatchObject({ eps_type_law_deductions_id: 4, eps_deduction: '0.00', pension_type_law_deductions_id: 6, pension_deduction: '0.00' });
  });
  it('detiene el envío si faltan EPS y pensión, sin crear valores o códigos', async () => {
    const { service, api } = build({ state: { ...state, lines: [state.lines[0]] } });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow(/EPS.*pensión/);
    expect(api.payrollRequest).not.toHaveBeenCalled();
  });
  it('pide banco y cuenta para transferencia, usando el catálogo real', async () => {
    const { service, query, api } = build();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string) => sql.startsWith('SELECT data,active FROM')
      ? [{ data: { ...worker, paymentMethodId: 100, bankName: '', accountType: '', accountNumber: '' }, active: true }] : original(sql));
    (service as any).catalogs.getPayrollWorkerCatalogs.mockResolvedValue({ paymentMethods: [{ id: 100, name: 'Transferencia', code: '30' }] });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow(/banco/);
    expect(api.payrollRequest).not.toHaveBeenCalled();
  });
});

it('sends both optional funds with code 9, preserving their entered amounts', async () => {
  const { service, api } = build({ state: { ...state, lines: [...state.lines,
    { id: 'fund', concept: 'solidarity', kind: 'deduction', quantity: '1', amount: '10', typeLawDeductionsId: 11 },
    { id: 'sub', concept: 'subsistence', kind: 'deduction', quantity: '1', amount: '20', typeLawDeductionsId: 12 },
  ] } });
  await service.send(company, actor, 'document-a');
  const body = api.payrollRequest.mock.calls[0][1] as any;
  expect(body.deductions).toMatchObject({ fondossp_type_law_deductions_id: 9, fondosp_deduction_SP: '10.00',
    fondossp_sub_type_law_deductions_id: 9, fondosp_deduction_sub: '20.00' });
});

describe('configuración del emisor antes del envío', () => {
  it('detiene un token de otra empresa antes de consumir un consecutivo o llamar a emisión', async () => {
    const { service, api, query } = build();
    api.getPayrollIssuerConfiguration.mockResolvedValue({ identificationNumber: '999999999', payrollEnvironment: 1, payrollSoftwareConfigured: true, payrollPinConfigured: true });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('NIT diferente');
    expect(api.payrollRequest).not.toHaveBeenCalled();
    expect(api.payrollPlanInfo).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes('next_number=next_number+1'))).toBe(false);
  });
  it('explica la falta del software específico de nómina', async () => {
    const { service, api } = build();
    api.getPayrollIssuerConfiguration.mockResolvedValue({ identificationNumber: '900123456', payrollEnvironment: 2, payrollSoftwareConfigured: false, payrollPinConfigured: false });
    await expect(service.send(company, actor, 'document-a')).rejects.toThrow('ID y el PIN');
    expect(api.payrollRequest).not.toHaveBeenCalled();
  });
});

it('las notas nuevas usan NA y avanzan solo su contador; reintentos conservan el n\u00famero reservado', async () => {
  for (const assigned of [false, true]) {
    const note = { ...document, original_id: 'original', state: { ...state, noteType: 1 }, ...(assigned ? { number: 7, prefix: 'NA' } : {}) };
    const { service, query, api } = build(note);
    const original = query.getMockImplementation()!;
    let documentLoads = 0;
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM jarvis_payroll_documents') && ++documentLoads === 2)
        return [{ ...document, id: 'original', status: 'ACCEPTED', number: 25, prefix: 'NI', cune: 'b'.repeat(96) }];
      if (sql.startsWith('SELECT * FROM jarvis_payroll_settings')) return [{ settings: { prefix: 'NI' }, next_number: 38, next_note_number: 7 }];
      return original(sql);
    });
    await service.send(company, actor, 'document-a');
    expect(api.payrollRequest).toHaveBeenCalledWith('payroll-adjust-note', expect.objectContaining({ type_document_id: 10, prefix: 'NA', consecutive: 7, predecessor: expect.objectContaining({ predecessor_number: 'NI25' }) }), 'private-token');
    expect(query.mock.calls.some(([sql]) => sql.includes('SET next_number=next_number+1'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('SET next_note_number=next_note_number+1'))).toBe(!assigned);
  }
});
