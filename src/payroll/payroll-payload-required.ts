import { cents, validDate } from './payroll-domain';

/** Validate the serialized request, including zero amounts, before reserving a transmission. */
export function payrollPayloadRequiredErrors(body: Record<string, any>): string[] {
  const errors: string[] = [];
  const value = (key: string) => key.split('.').reduce((node, part) => node?.[part], body);
  const fail = (key: string) => errors.push(`Completa o corrige ${key} antes de enviar la nómina.`);
  const text = (key: string) => { if (typeof value(key) !== 'string' || !value(key).trim()) fail(key); };
  const positiveId = (key: string) => { if (!Number.isSafeInteger(value(key)) || value(key) < 1) fail(key); };
  const amount = (key: string) => { try { cents(value(key)); } catch { fail(key); } };
  if (body.type_document_id === 10) {
    if (![1, 2].includes(body.type_note)) fail('type_note');
    for (const key of ['predecessor.predecessor_number', 'predecessor.predecessor_cune']) text(key);
    if (!validDate(value('predecessor.predecessor_issue_date'))) fail('predecessor.predecessor_issue_date');
    if (body.type_note === 2) {
      for (const key of ['consecutive', 'payroll_period_id']) positiveId(key);
      text('prefix');
      for (const key of ['period.admision_date', 'period.settlement_start_date', 'period.settlement_end_date', 'period.issue_date'])
        if (!validDate(value(key))) fail(key);
      if (!Number.isFinite(value('period.worked_time')) || value('period.worked_time') <= 0) fail('period.worked_time');
      return [...new Set(errors)];
    }
  }
  for (const key of ['type_document_id', 'consecutive', 'payroll_period_id', 'worker.type_worker_id',
    'worker.sub_type_worker_id', 'worker.payroll_type_document_identification_id', 'worker.municipality_id',
    'worker.type_contract_id', 'payment.payment_method_id', 'deductions.eps_type_law_deductions_id',
    'deductions.pension_type_law_deductions_id']) positiveId(key);
  for (const key of ['prefix', 'worker_code', 'worker.worker_code', 'worker.identification_number',
    'worker.surname', 'worker.first_name', 'worker.address']) text(key);
  for (const key of ['date', 'period.admision_date', 'period.settlement_start_date',
    'period.settlement_end_date', 'period.issue_date']) if (!validDate(value(key))) fail(key);
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value('time') ?? '')) fail('time');
  for (const key of ['worker.high_risk_pension', 'worker.integral_salarary', 'novelty.novelty'])
    if (typeof value(key) !== 'boolean') fail(key);
  if (!body.novelty || !Object.prototype.hasOwnProperty.call(body.novelty, 'uuidnov')) fail('novelty.uuidnov');
  for (const key of ['period.worked_time', 'accrued.worked_days'])
    if (!Number.isFinite(value(key)) || value(key) <= 0) fail(key);
  for (const key of ['worker.salary', 'accrued.salary', 'accrued.accrued_total',
    'deductions.eps_deduction', 'deductions.pension_deduction', 'deductions.deductions_total']) amount(key);
  if (!Array.isArray(body.payment_dates) || !body.payment_dates.length ||
    body.payment_dates.some((row: any) => !validDate(row?.payment_date))) fail('payment_dates');
  // NextPyme requires banking data for payment method 30; cash must remain bank-free.
  if (body.payment?.payment_method_id === 30) {
    for (const key of ['payment.bank_name', 'payment.account_type', 'payment.account_number']) text(key);
  }
  if (body.worker?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.worker.email)) fail('worker.email');
  if (body.deductions?.fondosp_deduction_sub !== undefined) {
    positiveId('deductions.fondossp_sub_type_law_deductions_id');
    amount('deductions.fondosp_deduction_sub');
  }
  if (body.deductions?.fondosp_deduction_SP !== undefined) {
    positiveId('deductions.fondossp_type_law_deductions_id');
    amount('deductions.fondosp_deduction_SP');
  }
  return [...new Set(errors)];
}
