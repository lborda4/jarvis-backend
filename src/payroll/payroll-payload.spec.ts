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
  paymentMethodId: 10,
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
    expect(buildPayrollPayload(state, worker, 1, 'NI')).toEqual({
      notes: state.notes,
      period: {
        issue_date: '2021-07-28',
        worked_time: '785.00',
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
      novelty: { novelty: false, uuidnov: null },
      payment: {
        bank_name: 'BANCO DAVIVIENDA',
        account_type: 'AHORROS',
        account_number: '00000000',
        payment_method_id: 10,
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
});
