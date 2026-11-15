import { buildPayrollPayload, type PayrollInput, type PayrollWorker } from './payroll-domain';
import { payrollPayloadRequiredErrors } from './payroll-payload-required';
import { payrollDefaultLawDeductions } from './payroll-required-deductions';
import { payrollSubmissionWorker } from './payroll-submission-worker';

const worker: PayrollWorker = {
  workerCode: 'EMP001', firstName: 'JUAN', surname: 'PÉREZ', identification: '1234567890',
  email: 'trabajador@email.com', salary: '1500000', admittanceDate: '2024-01-01',
  typeWorkerId: 1, subTypeWorkerId: 1, documentTypeId: 1, municipalityId: 149,
  typeContractId: 1, address: 'Calle 123 # 45-67', paymentMethodId: 10, paymentMethodType: 'cash',
};
const state: PayrollInput = {
  period: '2026-01', startDate: '2026-01-01', endDate: '2026-01-31', issueDate: '2026-02-05',
  workedDays: '30', payrollPeriodId: 5, paymentDates: ['2026-01-31'], lines: [
    { id: 's', concept: 'salary', kind: 'accrued', amount: '1500000', quantity: '30' },
    { id: 't', concept: 'transportation_allowance', kind: 'accrued', amount: '140606', quantity: '30' },
    { id: 'e', concept: 'eps', kind: 'deduction', amount: '60000', quantity: '1' },
    { id: 'p', concept: 'pension', kind: 'deduction', amount: '60000', quantity: '1' },
  ],
};
const payload = () => buildPayrollPayload(payrollDefaultLawDeductions(state), worker, 1, 'NI', undefined,
  { now: new Date('2026-02-05T05:05:06Z') });

it('completa el contrato de referencia con los valores reales, hora de Colombia y totales', () => {
  const body = payload();
  expect(payrollPayloadRequiredErrors(body)).toEqual([]);
  expect(body).toMatchObject({ date: '2026-02-05', time: '00:05:06', worker_code: 'EMP001',
    worker: { worker_code: 'EMP001', email: worker.email, municipality_id: 149, address: worker.address, type_contract_id: 1 },
    accrued: { accrued_total: '1640606.00' }, deductions: { deductions_total: '120000.00', eps_type_law_deductions_id: 4, pension_type_law_deductions_id: 6 } });
  expect(body.payment).toEqual({ payment_method_id: 10 });
  expect(body.period.worked_time).toBe(750); // Antigüedad 30/360, distinta de los días liquidados del mes.
});

it.each(['date', 'time', 'worker.municipality_id', 'worker.type_contract_id', 'worker.address',
  'worker.worker_code', 'worker.first_name', 'worker.payroll_type_document_identification_id',
  'period.admision_date', 'payment_dates', 'deductions.eps_deduction', 'deductions.pension_deduction'])
('detecta un obligatorio ausente en el JSON final: %s', key => {
  const body: any = payload();
  const parts = key.split('.');
  const node = parts.slice(0, -1).reduce((v, part) => v[part], body);
  delete node[parts[parts.length - 1]];
  expect(payrollPayloadRequiredErrors(body)).toContain(`Completa o corrige ${key} antes de enviar la nómina.`);
});

it('acepta ceros explícitos y exige banco solo para el método bancario 30', () => {
  const body = payload();
  body.deductions.eps_deduction = '0.00';
  body.deductions.pension_deduction = '0.00';
  expect(payrollPayloadRequiredErrors(body)).toEqual([]);
  body.payment.payment_method_id = 30;
  expect(payrollPayloadRequiredErrors(body)).toEqual(expect.arrayContaining([
    expect.stringContaining('payment.bank_name'), expect.stringContaining('payment.account_type'), expect.stringContaining('payment.account_number'),
  ]));
});

it('usa la ciudad, dirección, contrato, pago y correo corregidos sin recalcular el salario histórico', () => {
  const refreshed = payrollSubmissionWorker(worker, { email: 'nuevo@email.com', address: 'Nueva dirección',
    municipalityId: 439, typeContractId: 2, paymentMethodId: 30, paymentMethodType: 'transfer',
    bankName: 'Banco', accountType: 'AHORROS', accountNumber: '001234', salary: '9999999' });
  const body = buildPayrollPayload(payrollDefaultLawDeductions(state), refreshed, 1, 'NI');
  expect(payrollPayloadRequiredErrors(body)).toEqual([]);
  expect(body.worker).toMatchObject({ email: 'nuevo@email.com', address: 'Nueva dirección', municipality_id: 439, type_contract_id: 2, salary: '1500000.00' });
  expect(body.payment).toMatchObject({ payment_method_id: 30, account_number: '001234' });
});
