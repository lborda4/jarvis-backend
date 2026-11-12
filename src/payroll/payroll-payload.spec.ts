import {
  buildPayrollPayload,
  PayrollInput,
  PayrollWorker,
  validatePayroll,
} from './payroll-domain';

const worker: PayrollWorker = {
  workerCode: 'EMP001',
  salary: '1500000.00',
  address: 'BRR LIMONAR MZ 6 CS 3 ET 1',
  surname: 'PEREZ',
  firstName: 'PEPITO',
  secondSurname: 'PEREZ',
  typeWorkerId: 1,
  municipalityId: 439,
  typeContractId: 1,
  highRiskPension: false,
  integralSalary: false,
  subTypeWorkerId: 1,
  identification: '100000000',
  documentTypeId: 3,
  admittanceDate: '2018-10-10',
  paymentMethodId: 42,
  bankName: 'BANCO DAVIVIENDA',
  accountType: 'AHORROS',
  accountNumber: '00000000',
};
const state: PayrollInput = {
  period: '2021-07',
  issueDate: '2021-07-28',
  workedTime: '785.00',
  workedDays: '30',
  startDate: '2021-07-01',
  endDate: '2021-07-31',
  payrollPeriodId: 4,
  paymentDates: ['2021-03-10'],
  notes: 'PRUEBA DE ENVIO DE NOMINA ELECTRONICA',
  headNote: 'Encabezado',
  footNote: 'Pie de página',
  epsTypeLawDeductionsId: 1,
  pensionTypeLawDeductionsId: 5,
  lines: [
    {
      id: 'salary',
      concept: 'salary',
      kind: 'accrued',
      amount: '750000.00',
      quantity: '30',
    },
    {
      id: 'transport',
      concept: 'transportation_allowance',
      kind: 'accrued',
      amount: '115000.00',
      quantity: '30',
    },
    {
      id: 'eps',
      concept: 'eps',
      kind: 'deduction',
      amount: '60000.00',
      quantity: '1',
    },
    {
      id: 'pension',
      concept: 'pension',
      kind: 'deduction',
      amount: '60000.00',
      quantity: '1',
    },
  ],
};

describe('contrato de envío de nómina NextPyme', () => {
  it('usa los nombres y la estructura del curl y calcula los totales reales', () => {
    expect(buildPayrollPayload(state, { ...worker, highRiskPension: true }, 1, 'NI')).toEqual({
      notes: state.notes,
      period: {
        issue_date: '2021-07-28',
        worked_time: 1011,
        admision_date: '2018-10-10',
        settlement_end_date: '2021-07-31',
        settlement_start_date: '2021-07-01',
      },
      prefix: 'NI',
      worker: {
        salary: '1500000.00',
        address: worker.address,
        surname: 'PEREZ',
        first_name: 'PEPITO',
        middle_name: null,
        second_surname: 'PEREZ',
        type_worker_id: 1,
        municipality_id: 439,
        type_contract_id: 1,
        high_risk_pension: false,
        integral_salarary: false,
        sub_type_worker_id: 1,
        identification_number: '100000000',
        payroll_type_document_identification_id: 3,
      },
      accrued: {
        salary: '750000.00',
        worked_days: 30,
        accrued_total: '865000.00',
        transportation_allowance: '115000.00',
      },
      novelty: { novelty: false, uuidnov: '' },
      payment: {
        bank_name: 'BANCO DAVIVIENDA',
        account_type: 'AHORROS',
        account_number: '00000000',
        payment_method_id: 42,
      },
      sendmail: false,
      foot_note: state.footNote,
      head_note: state.headNote,
      deductions: {
        eps_deduction: '60000.00',
        deductions_total: '120000.00',
        pension_deduction: '60000.00',
        eps_type_law_deductions_id: 1,
        pension_type_law_deductions_id: 5,
      },
      consecutive: 1,
      worker_code: 'EMP001',
      sendmailtome: false,
      payment_dates: [{ payment_date: '2021-03-10' }],
      type_document_id: 9,
      payroll_period_id: 4,
    });
  });

  it('toma el ingreso del empleado y las fechas y días de la nómina sin sustituir emisión por pago', () => {
    const payload = buildPayrollPayload({ ...state, period: '2026-01', startDate: '2026-01-01', endDate: '2026-01-31', workedDays: '30', workedTime: undefined, issueDate: '2026-02-05', paymentDates: ['2026-01-31'] }, { ...worker, admittanceDate: '2024-01-01' }, 1, 'SETP');
    expect(payload.period).toEqual({ admision_date: '2024-01-01', settlement_start_date: '2026-01-01', settlement_end_date: '2026-01-31', worked_time: 750, issue_date: '2026-02-05' });
    expect(payload.payment_dates).toEqual([{ payment_date: '2026-01-31' }]);
  });
  it('omite datos bancarios de efectivo incluso si quedaron en una captura antigua', () => {
    const payload = buildPayrollPayload(state, { ...worker, paymentMethodId: 10 }, 1, 'NI');
    expect(payload.payment).toEqual({ payment_method_id: 10 });
  });
  it('usa las claves bancarias de NextPyme y conserva los ceros iniciales', () => {
    const payload = buildPayrollPayload(state, { ...worker, bankName: ' Banco ', accountType: ' corriente ', accountNumber: ' 001234 ' }, 1, 'NI');
    expect(payload.payment).toEqual({ payment_method_id: 42, bank_name: 'Banco', account_type: 'CORRIENTE', account_number: '001234' });
  });
  it.each([
    { bankName: '' }, { bankName: '   ' }, { accountType: '' }, { accountType: 'OTRO' }, { accountNumber: '' }, { accountNumber: '12abc' },
  ])('bloquea envíos bancarios incompletos o inválidos: %j', fields => {
    expect(() => buildPayrollPayload(state, { ...worker, ...fields }, 1, 'NI')).toThrow(/banco|cuenta/);
  });
  it.each([undefined, '', '   '])('no sustituye un código ausente por la identificación: %s', workerCode => {
    expect(() => buildPayrollPayload(state, { ...worker, workerCode }, 1, 'NI')).toThrow('código asignado');
  });

  it('mantiene el código en nóminas y notas de ajuste sin cambiar la identificación', () => {
    const predecessor = { predecessor_number: 'NI1', predecessor_cune: 'cune', predecessor_issue_date: '2021-07-28' };
    for (const previous of [undefined, predecessor]) {
      const payload = buildPayrollPayload({ ...state, noteType: 1 }, worker, 2, 'NI', previous);
      expect(payload.worker_code).toBe('EMP001');
      expect(payload.worker.identification_number).toBe('100000000');
    }
  });

  it('conserva segundos nombres y agrega conceptos repetidos sin perder centavos', () => {
    const payload = buildPayrollPayload(
      {
        ...state,
        lines: [
          ...state.lines,
          { ...state.lines[0], id: 'extra', amount: '0.01' },
        ],
      },
      { ...worker, secondName: 'JOSE' },
      2,
      'NI',
    );
    expect(payload.worker.middle_name).toBe('JOSE');
    expect(payload.accrued.salary).toBe('750000.01');
    expect(payload.accrued.accrued_total).toBe('865000.01');
  });

  it('rechaza códigos faltantes sin asignar los del ejemplo como valores por defecto', () => {
    expect(() =>
      buildPayrollPayload(
        { ...state, payrollPeriodId: undefined },
        worker,
        1,
        'NI',
      ),
    ).toThrow('período');
    expect(() =>
      buildPayrollPayload(
        state,
        { ...worker, typeContractId: undefined },
        1,
        'NI',
      ),
    ).toThrow('contrato');
    expect(() =>
      buildPayrollPayload(
        { ...state, epsTypeLawDeductionsId: undefined },
        worker,
        1,
        'NI',
      ),
    ).toThrow('deducción legal');
  });

  it('permite guardar borradores incompletos, pero valida los datos al transmitir', () => {
    const incomplete = { ...state, paymentDates: [] };
    expect(validatePayroll(incomplete, worker)).toEqual([]);
    expect(validatePayroll(incomplete, worker, true)).toContain(
      'Completa las fechas de pago de la nómina.',
    );
  });

  it('conserva la referencia de las notas de ajuste', () => {
    const predecessor = {
      predecessor_number: 'NI1',
      predecessor_cune: 'cune',
      predecessor_issue_date: '2021-07-28',
    };
    const payload = buildPayrollPayload(
      { ...state, noteType: 1 },
      worker,
      2,
      'NA',
      predecessor,
    );
    expect(payload).toMatchObject({
      type_document_id: 10,
      type_note: 1,
      predecessor,
      consecutive: 2,
    });
  });

  it('mapea horas extra nocturnas en el payload con la estructura del proveedor', () => {
    const payload = buildPayrollPayload(
      {
        ...state,
        period: '2021-07',
        startDate: '2021-07-10',
        endDate: '2021-07-11',
        lines: [
          ...state.lines,
          {
            id: 'night-overtime',
            concept: 'overtime_night',
            kind: 'accrued',
            amount: '200000.00',
            quantity: '4',
            startTime: '2021-07-10T22:00:00',
            endTime: '2021-07-11T02:00:00',
            overtimeSurchargeId: 175,
          },
        ],
      },
      worker,
      2,
      'NI',
    );

    expect(payload.accrued.HENs).toEqual([
      {
        start_time: '2021-07-10T22:00:00',
        end_time: '2021-07-11T02:00:00',
        quantity: 4,
        percentage: 175,
        payment: '200000.00',
      },
    ]);
  });
});

describe('cálculo independiente de días y antigüedad', () => {
  it.each([
    ['2026-01-01', '2026-10-01', '2026-10-31', undefined, '30', 300],
    ['2026-01-01', '2026-10-01', '2026-10-15', undefined, '15', 285],
    ['2026-10-10', '2026-10-01', '2026-10-15', undefined, '6', 6],
    ['2026-01-01', '2026-10-01', '2026-10-31', '2026-10-10', '10', 280],
    ['2026-01-01', '2026-02-01', '2026-02-28', undefined, '30', 60],
    ['2028-01-01', '2028-02-01', '2028-02-29', undefined, '30', 60],
  ])('separa ingreso %s, período %s a %s, retiro %s', (admittanceDate, startDate, endDate, retirementDate, workedDays, tenure) => {
    const payload = buildPayrollPayload({ ...state, period: startDate.slice(0, 7), startDate, endDate, workedDays, workedTime: '999999', issueDate: '2029-01-01', paymentDates: ['2029-01-02'] }, { ...worker, admittanceDate, retirementDate }, 1, 'SETP');
    expect(payload.period.worked_time).toBe(tenure);
    expect(payload.accrued.worked_days).toBe(Number(workedDays));
  });
});

describe('borradores con importes manuales', () => {
  it('permite guardar una nómina vacía pero bloquea su envío', () => {
    const empty = { ...state, lines: [] };
    expect(validatePayroll(empty, worker)).toEqual([]);
    expect(() => buildPayrollPayload(empty, worker, 1, 'SETP')).toThrow('Agrega al menos un devengado.');
  });
  it('envía el importe ingresado sin prorratear el salario del empleado', () => {
    const manual = { ...state, workedDays: '15', lines: [{ ...state.lines[0], amount: '123456.78', quantity: '15', manual: true }] };
    const payload = buildPayrollPayload(manual, { ...worker, salary: '9000000' }, 1, 'SETP');
    expect(payload.accrued.salary).toBe('123456.78');
    expect(payload.accrued.accrued_total).toBe('123456.78');
  });
});

describe('Horas extra diurnas', () => {
  const overtime = { id: 'hed', concept: 'overtime_day', kind: 'accrued' as const, quantity: '2.5', amount: '100000.25', startTime: '2021-07-08T17:00:00', endTime: '2021-07-08T19:30:00', overtimeSurchargeId: 19 };
  it('envía HEDs como arreglo y usa el ID de recargo como percentage', () => {
    const payload = buildPayrollPayload({ ...state, lines: [...state.lines, overtime, { ...overtime, id: 'hed2', startTime: '2021-07-09T17:00:00', endTime: '2021-07-09T19:30:00' }] }, worker, 1, 'SETP');
    expect(payload.accrued.HEDs).toEqual([
      { start_time: overtime.startTime, end_time: overtime.endTime, quantity: 2.5, percentage: 19, payment: '100000.25' },
      { start_time: '2021-07-09T17:00:00', end_time: '2021-07-09T19:30:00', quantity: 2.5, percentage: 19, payment: '100000.25' },
    ]);
    expect(payload.accrued.accrued_total).toBe('1065000.50');
  });
  it('omite HEDs si no hay horas extra diurnas', () => expect(buildPayrollPayload(state, worker, 1, 'SETP').accrued).not.toHaveProperty('HEDs'));
  it.each([{ startTime: '' }, { endTime: '2021-07-08T16:00:00' }, { overtimeSurchargeId: 0 }, { quantity: '0' }, { endTime: '2021-08-01T17:00:00' }])('impide el envío si faltan datos: %j', patch => {
    expect(() => buildPayrollPayload({ ...state, lines: [...state.lines, { ...overtime, ...patch }] }, worker, 1, 'SETP')).toThrow();
  });
});

describe('incapacidades homologadas', () => {
  const disability = { id: 'disability', concept: 'disability', kind: 'accrued' as const, quantity: '3', amount: '12345.67', startDate: '2021-07-08', endDate: '2021-07-10', type: 17 };
  it('conserva fechas, cantidad, ID maestro y pago en work_disabilities', () => {
    const payload = buildPayrollPayload({ ...state, lines: [...state.lines, disability] }, worker, 1, 'NI');
    expect(payload.accrued.work_disabilities).toEqual([{ start_date: '2021-07-08', end_date: '2021-07-10', quantity: 3, type: 17, payment: '12345.67' }]);
  });
  it.each([{ type: undefined }, { type: 0 }, { type: 1.5 }, { startDate: '' }, { endDate: '2021-07-01' }, { startDate: '2021-06-30' }, { quantity: '0' }, { quantity: '1.5' }])('rechaza una incapacidad incompleta: %j', patch => {
    expect(() => buildPayrollPayload({ ...state, lines: [...state.lines, { ...disability, ...patch }] }, worker, 1, 'NI')).toThrow();
  });
  it('homologa también un concepto interno mapeado a incapacidad', () => {
    const payload = buildPayrollPayload({ ...state, lines: [...state.lines, { ...disability, concept: 'internal_disability', mapping: 'disability' }] }, worker, 1, 'NI');
    expect(payload.accrued.work_disabilities).toEqual([expect.objectContaining({ type: 17 })]);
  });
});

describe('deducciones de ley homologadas', () => {
  const deduction = (concept: string, id: number, amount = '10.25') => ({ id: concept, concept, kind: 'deduction' as const, quantity: '1', amount, typeLawDeductionsId: id });
  const lines = [state.lines[0], deduction('eps', 31), deduction('pension', 51), deduction('solidarity', 91), deduction('subsistence', 92)];
  it('envía exactamente los ocho campos legales y el total, sin porcentajes manuales', () => {
    expect(buildPayrollPayload({ ...state, lines }, worker, 1, 'NI').deductions).toEqual({
      eps_type_law_deductions_id: 31, eps_deduction: '10.25', pension_type_law_deductions_id: 51, pension_deduction: '10.25',
      fondossp_type_law_deductions_id: 91, fondosp_deduction_SP: '10.25', fondossp_sub_type_law_deductions_id: 92, fondosp_deduction_sub: '10.25', deductions_total: '41.00',
    });
  });
  it('omite fondos no elegidos y conserva deducciones en cero con tipo explícito', () => {
    const result = buildPayrollPayload({ ...state, lines: [state.lines[0], deduction('eps', 31, '0'), deduction('pension', 51, '0')] }, worker, 1, 'NI').deductions;
    expect(result).toEqual({ eps_type_law_deductions_id: 31, eps_deduction: '0.00', pension_type_law_deductions_id: 51, pension_deduction: '0.00', deductions_total: '0.00' });
  });
  it('rechaza dos IDs distintos para el mismo concepto', () => {
    expect(() => buildPayrollPayload({ ...state, lines: [...lines, deduction('eps', 32)] }, worker, 1, 'NI')).toThrow('mezcles');
  });
  it.each(['eps', 'pension', 'solidarity', 'subsistence'])('rechaza %s sin ID y sin fallback', concept => {
    const line = { ...deduction(concept, 1), typeLawDeductionsId: undefined };
    expect(() => buildPayrollPayload({ ...state, epsTypeLawDeductionsId: undefined, pensionTypeLawDeductionsId: undefined, lines: [state.lines[0], line] }, worker, 1, 'NI')).toThrow();
  });
  it('acepta cambiar la selección de EPS aunque el borrador conserve el ID anterior', () => {
    expect(buildPayrollPayload({ ...state, lines: [state.lines[0], deduction('eps', 31)] }, worker, 1, 'NI').deductions.eps_type_law_deductions_id).toBe(31);
  });
});

describe('sindicatos, sanciones y libranzas', () => {
  const union = { id: 'union', concept: 'labor_union', kind: 'deduction' as const, quantity: '1', amount: '10.25', percentage: '2.5' };
  const sanction = { id: 'sanction', concept: 'sanctions', kind: 'deduction' as const, quantity: '1', amount: '30.30', publicSanction: '10.10', privateSanction: '20.20' };
  const order = { id: 'order', concept: 'loan', kind: 'deduction' as const, quantity: '1', amount: '50.25', description: '  Crédito de vivienda  ' };
  it('conserva las filas de cada arreglo y sus valores, y suma el total una sola vez', () => {
    const payload = buildPayrollPayload({ ...state, lines: [state.lines[0], union, sanction, order, { ...order, id: 'order2', description: 'Otro crédito' }] }, worker, 1, 'NI');
    expect(payload.deductions).toEqual({ deductions_total: '141.05', labor_union: [{ percentage: 2.5, deduction: 10.25 }], sanctions: [{ public_sanction: 10.1, private_sanction: 20.2 }], orders: [{ description: 'Crédito de vivienda', deduction: 50.25 }, { description: 'Otro crédito', deduction: 50.25 }] });
  });
  it.each(['publicSanction', 'privateSanction'])('permite una sola sanción: %s', field => {
    const line = { ...sanction, amount: '10', publicSanction: '', privateSanction: '', [field]: '10' };
    const result = buildPayrollPayload({ ...state, lines: [state.lines[0], line] }, worker, 1, 'NI').deductions;
    expect(result.sanctions).toEqual([field === 'publicSanction' ? { public_sanction: 10 } : { private_sanction: 10 }]);
    expect(result).not.toHaveProperty('orders');
    expect(result).not.toHaveProperty('labor_union');
  });
  it.each([{ ...union, percentage: '' }, { ...union, percentage: '101' }, { ...union, percentage: '-1' }, { ...order, description: '  ' }, { ...sanction, amount: '10' }, { ...sanction, publicSanction: '-10' }, { ...sanction, amount: '0', publicSanction: '', privateSanction: '' }])('bloquea datos incompletos o inconsistentes: %j', line => {
    expect(() => buildPayrollPayload({ ...state, lines: [state.lines[0], line] }, worker, 1, 'NI')).toThrow();
  });
});

describe('deducciones por valor', () => {
  const keys = ['third_party_payment_deduction', 'advance', 'other_deduction', 'voluntary', 'withholding', 'afc', 'cooperative', 'garnishment', 'supplementary_plan', 'education', 'refund_deduction', 'debt'];
  const lines = keys.map(concept => ({ id: concept, concept, kind: 'deduction' as const, quantity: '1', amount: '10.25', ...(concept === 'other_deduction' ? { description: '  Cuota especial  ' } : {}) }));
  it('transmite los arreglos, escalares y total del período con los nombres exactos', () => {
    expect(buildPayrollPayload({ ...state, lines: [state.lines[0], ...lines] }, worker, 1, 'NI').deductions).toEqual({
      third_party_payments: [{ third_party_payment: 10.25 }], advances: [{ advance: 10.25 }], other_deductions: [{ other_deduction: 10.25, description_deduction: 'Cuota especial' }],
      voluntary_pension: 10.25, withholding_at_source: 10.25, afc: 10.25, cooperative: 10.25, tax_liens: 10.25, supplementary_plan: 10.25, education: 10.25, refund: 10.25, debt: 10.25, deductions_total: '123.00',
    });
  });
  it('conserva varias filas, omite descripción vacía y suma escalares sin duplicar', () => {
    const chosen = [
      { ...lines[2], description: '' }, { ...lines[2], id: 'other2', description: 'Otra cuota' },
      { ...lines[3], amount: '0.10' }, { ...lines[3], id: 'voluntary2', amount: '0.20' },
    ];
    expect(buildPayrollPayload({ ...state, lines: [state.lines[0], ...chosen] }, worker, 1, 'NI').deductions).toEqual({ other_deductions: [{ other_deduction: 10.25 }, { other_deduction: 10.25, description_deduction: 'Otra cuota' }], voluntary_pension: 0.3, deductions_total: '20.80' });
  });
  it.each(['-1', '1.234', 'abc'])('rechaza importes inválidos %s antes de transmitir', amount => {
    expect(() => buildPayrollPayload({ ...state, lines: [state.lines[0], { ...lines[0], amount }] }, worker, 1, 'NI')).toThrow();
  });
  it('acepta alias externos en conceptos internos de deducción', () => {
    const chosen = [{ ...lines[0], concept: 'internal_third', mapping: 'third_party_payments' }, { ...lines[1], concept: 'internal_advance', mapping: 'advances' }, { ...lines[10], concept: 'internal_refund', mapping: 'refund' }];
    expect(buildPayrollPayload({ ...state, lines: [state.lines[0], ...chosen] }, worker, 1, 'NI').deductions).toEqual({ third_party_payments: [{ third_party_payment: 10.25 }], advances: [{ advance: 10.25 }], refund: 10.25, deductions_total: '30.75' });
  });
});
