import { PayrollInput, PayrollLine, PayrollWorker, cents, money, totals, validDate } from './payroll-domain';
import { payrollPeriodBounds } from './payroll-period';
import { payrollWorkedTime } from './payroll-employment';

export interface MonthlySource {
  id: string; employee_id: string; status: string; original_id?: string | null;
  state: PayrollInput & Record<string, any>; employee_snapshot: PayrollWorker;
  parameter_snapshot: any; updated_at: Date | string; sourceVersion?: string; sent_at?: unknown; number?: unknown; cune?: unknown;
}
export function monthlyRevisions(rows: MonthlySource[]) {
  return rows.map(row => ({ id: row.id, updatedAt: new Date(row.updated_at).toISOString(), ...(row.sourceVersion ? { version: row.sourceVersion } : {}) })).sort((a, b) => a.id.localeCompare(b.id));
}
export function assertMonthlyRevisions(rows: MonthlySource[], expected: unknown) {
  if (!Array.isArray(expected) || JSON.stringify(monthlyRevisions(rows)) !== JSON.stringify([...expected].map(row => ({ id: row?.id, updatedAt: row?.updatedAt, ...(row?.version ? { version: row.version } : {}) })).sort((a, b) => String(a.id).localeCompare(String(b.id)))))
    throw new Error('La nómina cambió desde que abriste el resumen. Actualiza el mes y revisa los valores antes de enviar.');
}
export function consolidatePayrollMonth(month: string, rows: MonthlySource[], payrollPeriodId: number, issueDate: string) {
  const bounds = payrollPeriodBounds(month, 'MONTHLY');
  if (!rows.length) throw new Error('No hay períodos para consolidar.');
  const sorted = [...rows].sort((a, b) => a.state.startDate.localeCompare(b.state.startDate));
  const worker = sorted.at(-1)!.employee_snapshot;
  let days = 0n;
  const lines: PayrollLine[] = [];
  for (const [index, row] of sorted.entries()) {
    if (row.original_id || row.state.monthlyConsolidation?.generated || row.employee_id !== rows[0].employee_id)
      throw new Error('Solo se pueden consolidar períodos originales de un mismo empleado.');
    if (!validDate(row.state.startDate) || !validDate(row.state.endDate) || row.state.startDate < bounds.startDate || row.state.endDate > bounds.endDate || row.state.startDate > row.state.endDate)
      throw new Error('Todos los períodos deben pertenecer al mes seleccionado.');
    if (index && sorted[index - 1].state.endDate >= row.state.startDate)
      throw new Error('Hay períodos superpuestos para el empleado. Corrige las fechas antes de enviar.');
    if (row.employee_snapshot.identification !== worker.identification || row.employee_snapshot.admittanceDate !== worker.admittanceDate || !!row.employee_snapshot.integralSalary !== !!worker.integralSalary)
      throw new Error('Los datos del empleado difieren entre períodos. Revisa su identificación, ingreso y salario integral.');
    days += cents(row.state.workedDays);
    for (const line of row.state.lines) {
      const key = line.mapping ?? line.concept;
      lines.push({ ...line, id: line.id.startsWith(`${row.id}:`) ? line.id : `${row.id}:${line.id}`, manual: true, formula: undefined,
        ...(['eps', 'pension'].includes(key) ? { typeLawDeductionsId: line.typeLawDeductionsId ?? (key === 'eps' ? row.state.epsTypeLawDeductionsId : row.state.pensionTypeLawDeductionsId) } : {}),
      });
    }
  }
  let workedTime = sorted[0].state.workedTime;
  try { workedTime = String(payrollWorkedTime(bounds.endDate, worker)); } catch { /* NextPyme validates missing employment dates. */ }
  const state: PayrollInput & Record<string, any> = { ...sorted[0].state, ...bounds, period: month, issueDate, workedDays: money(days), workedTime, payrollPeriodId,
    payrollName: `Nómina mensual ${month}`, periodicity: 'MONTHLY', paymentDates: [...new Set(sorted.flatMap(row => row.state.paymentDates ?? []))].sort(), lines,
  };
  delete state.payrollGroupId;
  delete state.monthlyDocumentId;
  delete state.monthlyConsolidation;
  delete state.epsTypeLawDeductionsId;
  delete state.pensionTypeLawDeductionsId;
  const concepts = new Map<string, any>();
  for (const row of sorted) for (const concept of row.parameter_snapshot?.concepts ?? []) {
    const key = `${concept.kind}:${concept.code}`;
    concepts.set(key, concept);
  }
  return { state, worker, parameters: { ...sorted.at(-1)!.parameter_snapshot, concepts: [...concepts.values()] }, ...totals(lines) };
}
