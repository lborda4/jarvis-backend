import { buildPayrollPayload, cents, money, totals, type PayrollInput, type PayrollWorker } from './payroll-domain';
import { payrollPredecessor } from './payroll-adjustment';

export function payrollReplacementTotals(lines: PayrollInput['lines']) {
  const base = totals(lines);
  const extra = lines.filter(line => line.kind === 'accrued').reduce((sum, line) => {
    const key = line.mapping ?? line.concept;
    return sum + (['service_bonus', 'premium'].includes(key) ? cents(line.paymentNS || '0') : key === 'severance' ? cents(line.interestPayment || '0') : 0n);
  }, 0n);
  return { accrued: money(cents(base.accrued) + extra), deductions: base.deductions, net: money(cents(base.accrued) + extra - cents(base.deductions)) };
}

/** Campos estructurados del ejemplo de payroll-adjust-note proporcionado. */
export function buildPayrollReplacementPayload(state: PayrollInput, worker: PayrollWorker, number: number, prefix: string, predecessor: ReturnType<typeof payrollPredecessor>) {
  const body = buildPayrollPayload(state, worker, number, prefix, predecessor, { validation: 'provider' });
  const accrued = { ...body.accrued } as Record<string, any>;
  body.accrued = accrued;
  body.deductions = { ...body.deductions };
  const push = (key: string, entry: Record<string, any>) => {
    if (!Array.isArray(accrued[key])) accrued[key] = [];
    accrued[key].push(entry);
  };
  const mapped = new Set<string>();
  const dates = (line: PayrollInput['lines'][number], payment = true) => ({
    start_date: line.startDate ?? state.startDate, end_date: line.endDate ?? state.endDate, quantity: Number(line.quantity),
    ...(payment ? { payment: money(cents(line.amount)) } : {}),
  });
  // El serializador general conserva conceptos no verificados como escalares.
  // Para el reemplazo se traducen a los objetos y listas del contrato de ajuste.
  const entries: Array<[string, Record<string, any>]> = [];
  for (const line of state.lines) {
    const key = line.mapping ?? line.concept;
    const payment = money(cents(line.amount));
    let entry: [string, Record<string, any>] | undefined;
    if (['vacation', 'common_vacation'].includes(key)) entry = ['common_vacation', dates(line)];
    else if (['vacation_paid', 'paid_vacation'].includes(key)) entry = ['paid_vacation', { quantity: Number(line.quantity), payment }];
    else if (line.kind === 'accrued' && ['service_bonus', 'premium'].includes(key)) entry = ['service_bonus', { quantity: Number(line.quantity), payment, paymentNS: money(cents(line.paymentNS || '0')) }];
    else if (key === 'severance') entry = ['severance', { payment, percentage: line.percentage || '0', interest_payment: money(cents(line.interestPayment || '0')) }];
    else if (key === 'severance_interest') entry = ['severance', { payment: '0.00', percentage: line.percentage || '0', interest_payment: payment }];
    else if (['parental_leave', 'maternity_leave'].includes(key)) entry = ['maternity_leave', dates(line)];
    else if (key === 'paid_leave') entry = ['paid_leave', dates(line)];
    else if (['unpaid_leave', 'non_paid_leave'].includes(key)) entry = ['non_paid_leave', dates(line, false)];
    else if (['salary_bonus', 'non_salary_bonus'].includes(key)) entry = ['bonuses', { [key]: payment }];
    else if (['salary_assistance', 'non_salary_assistance'].includes(key)) entry = ['aid', { [key]: payment }];
    else if (key === 'legal_strike') entry = ['legal_strike', dates(line, false)];
    else if (['other', 'other_concepts', 'allowance', 'travel'].includes(key)) entry = ['other_concepts', { salary_concept: payment, non_salary_concept: '0.00', description_concept: line.description?.trim() || 'Otro ingreso' }];
    else if (['ordinary_compensation', 'extraordinary_compensation'].includes(key)) entry = ['compensations', { [key]: payment }];
    else if (key === 'commissions' && line.kind === 'accrued') entry = ['commissions', { commission: payment }];
    else if (key === 'third_party_payments' && line.kind === 'accrued') entry = ['third_party_payments', { third_party_payment: payment }];
    else if (key === 'advances' && line.kind === 'accrued') entry = ['advances', { advance: payment }];
    if (entry) { mapped.add(key); entries.push(entry); }
    else if (key === 'retirement_bonus') { mapped.add(key); accrued.withdrawal_bonus = money(cents(accrued.withdrawal_bonus ?? '0') + cents(line.amount)); }
  }
  for (const key of mapped) { delete accrued[key]; if (state.lines.some(line => line.kind === 'deduction' && (line.mapping ?? line.concept) === key)) delete (body.deductions as Record<string, any>)[key]; }
  for (const [key, entry] of entries) push(key, entry);
  accrued.accrued_total = payrollReplacementTotals(state.lines).accrued;
  return body;
}
