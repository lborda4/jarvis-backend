/** Monetary values are decimal strings; integer arithmetic avoids binary rounding. */
export function cents(value: unknown): bigint {
  const text = String(value ?? '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text))
    throw new Error('Ingresa un valor positivo con máximo dos decimales.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function money(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function prorate(
  amount: string,
  quantity: string,
  divisor: string,
): string {
  const base = cents(amount),
    units = cents(quantity),
    reference = cents(divisor);
  if (reference <= 0n)
    throw new Error('Configura una base de cálculo mayor que cero.');
  return money((base * units + reference / 2n) / reference);
}
export interface PayrollLine {
  id: string;
  concept: string;
  kind: 'accrued' | 'deduction';
  amount: string;
  quantity: string;
  percentage?: string;
  startDate?: string;
  endDate?: string;
  formula?: string;
  manual?: boolean;
  mapping?: string;
}
export interface PayrollInput {
  period: string;
  startDate: string;
  endDate: string;
  issueDate: string;
  workedDays: string;
  lines: PayrollLine[];
  noteType?: number;
}
export interface PayrollWorker {
  firstName: string;
  surname: string;
  secondName?: string;
  secondSurname?: string;
  identification: string;
  salary: string;
  admittanceDate: string;
  retirementDate?: string;
  active?: boolean;
  paymentMethodId: number;
  typeWorkerId: number;
  subTypeWorkerId: number;
  documentTypeId: number;
  highRiskPension?: boolean;
  integralSalary?: boolean;
  bankName?: string;
  accountType?: string;
  accountNumber?: string;
}
export const VERIFIED_CONCEPTS = [
  'salary',
  'transportation_allowance',
  'eps',
  'pension',
];
export function totals(lines: PayrollLine[]) {
  let accrued = 0n,
    deductions = 0n;
  for (const line of lines) {
    if (line.kind === 'accrued') accrued += cents(line.amount);
    else if (line.kind === 'deduction') deductions += cents(line.amount);
    else throw new Error('Naturaleza del concepto inválida.');
  }
  return {
    accrued: money(accrued),
    deductions: money(deductions),
    net: money(accrued - deductions),
  };
}
export function validDate(value: string): boolean {
  const date = new Date(value);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}
export function validatePayroll(
  state: PayrollInput,
  employee: PayrollWorker | null | undefined,
  transmission = false,
): string[] {
  const errors: string[] = [];
  if (!employee) errors.push('Selecciona un empleado de esta empresa.');
  if (
    !validDate(state.startDate) ||
    !validDate(state.endDate) ||
    state.startDate > state.endDate
  )
    errors.push('Revisa las fechas del período.');
  if (!validDate(state.issueDate)) errors.push('Revisa la fecha de emisión.');
  if (
    !/^\d{4}-\d{2}$/.test(state.period ?? '') ||
    state.startDate?.slice(0, 7) !== state.period ||
    state.endDate?.slice(0, 7) !== state.period
  )
    errors.push('El período debe coincidir con las fechas de liquidación.');
  if (!Array.isArray(state.lines) || !state.lines.length)
    errors.push('Agrega al menos un devengado.');
  else {
    if (state.lines.some((l: PayrollLine) => !l || typeof l !== 'object'))
      return ['Revisa los conceptos de nómina.'];
    try {
      const total = totals(state.lines);
      if (total.net.startsWith('-'))
        errors.push('Las deducciones superan los devengados.');
    } catch {
      errors.push('Revisa los valores de los conceptos.');
    }
    if (!state.lines.some((l: PayrollLine) => l.kind === 'accrued'))
      errors.push('Agrega un devengado.');
    if (
      transmission &&
      state.lines.some(
        (l: PayrollLine) => !VERIFIED_CONCEPTS.includes(l.mapping ?? l.concept),
      )
    )
      errors.push('Hay conceptos pendientes de integración con NextPyme.');
    if (
      state.lines.some((l: PayrollLine) =>
        ['eps', 'pension'].includes(l.mapping ?? l.concept)
          ? l.kind !== 'deduction'
          : VERIFIED_CONCEPTS.includes(l.mapping ?? l.concept) &&
            l.kind !== 'accrued',
      )
    )
      errors.push('La naturaleza de un concepto es incorrecta.');
    for (const line of state.lines as PayrollLine[]) {
      try {
        if (cents(line.quantity) < 0n) errors.push('Cantidad inválida.');
        if (line.percentage !== undefined && cents(line.percentage) > 10000n)
          errors.push('Porcentaje fuera de rango.');
        if (
          transmission &&
          ['eps', 'pension'].includes(line.mapping ?? line.concept) &&
          cents(line.amount) > 0n &&
          cents(line.percentage ?? '0') === 0n
        )
          errors.push(
            'Completa el porcentaje de salud y pensión antes de transmitir.',
          );
        if (
          transmission &&
          ['salary', 'transportation_allowance'].includes(
            line.mapping ?? line.concept,
          ) &&
          cents(line.quantity) === 0n
        )
          errors.push('Completa los días de salario y auxilio de transporte.');
      } catch {
        errors.push('Revisa cantidades y porcentajes.');
      }
      if (
        (line.startDate || line.endDate) &&
        (!validDate(line.startDate ?? '') ||
          !validDate(line.endDate ?? '') ||
          line.startDate! > line.endDate!)
      )
        errors.push('Revisa las fechas de las novedades.');
    }
  }
  try {
    if (cents(state.workedDays) <= 0n || cents(state.workedDays) > 3100n)
      errors.push('Revisa los días trabajados.');
  } catch {
    errors.push('Revisa los días trabajados.');
  }
  if (employee && employee.active === false && transmission)
    errors.push('El empleado está inactivo.');
  if (employee && state.endDate < employee.admittanceDate)
    errors.push('El período termina antes del ingreso del empleado.');
  if (
    transmission &&
    (!employee?.paymentMethodId ||
      !employee?.typeWorkerId ||
      !employee?.subTypeWorkerId)
  )
    errors.push('Completa los datos de pago y trabajador.');
  if (transmission && (employee?.secondName || employee?.secondSurname))
    errors.push(
      'El envío de segundos nombres y apellidos está pendiente de verificar en el esquema completo de NextPyme. Se conservan en el empleado.',
    );
  if (employee?.retirementDate && state.startDate > employee.retirementDate)
    errors.push('El período comienza después del retiro del empleado.');
  return [...new Set(errors)];
}
export function buildPayrollPayload(
  state: PayrollInput,
  worker: PayrollWorker,
  number: number,
  prefix: string,
  predecessor?: {
    predecessor_number: string;
    predecessor_cune: string;
    predecessor_issue_date: string;
  },
) {
  const errors = validatePayroll(state, worker, true);
  if (errors.length) throw new Error(errors.join(' '));
  const accrued: Record<string, { payment: string; worked_days: string }[]> =
      {},
    deductions: Record<string, { payment: string; percentage: string }> = {};
  for (const line of state.lines as PayrollLine[]) {
    const key = line.mapping ?? line.concept;
    if (line.kind === 'accrued')
      (accrued[key] ??= []).push({
        payment: money(cents(line.amount)),
        worked_days: money(cents(line.quantity)),
      });
    else {
      const previous = deductions[key];
      if (
        previous &&
        previous.percentage !== money(cents(line.percentage ?? '0'))
      )
        throw new Error(
          'Agrupa las deducciones del mismo concepto con el mismo porcentaje.',
        );
      deductions[key] = {
        payment: money(
          cents(line.amount) + (previous ? cents(previous.payment) : 0n),
        ),
        percentage: money(cents(line.percentage ?? '0')),
      };
    }
  }
  return {
    type_document_id: predecessor ? 10 : 9,
    ...(predecessor
      ? { type_note: state.noteType, predecessor }
      : { predecessor: {} }),
    number,
    prefix,
    period: {
      admittance_date: worker.admittanceDate,
      settlement_start_date: state.startDate,
      settlement_end_date: state.endDate,
      worked_time: money(cents(state.workedDays)),
      issue_date: state.issueDate,
    },
    worker: {
      type_worker_id: worker.typeWorkerId,
      sub_type_worker_id: worker.subTypeWorkerId,
      type_document_identification_id: worker.documentTypeId,
      identification_number: worker.identification,
      surname: worker.surname,
      first_name: worker.firstName,
      high_risk_pension: !!worker.highRiskPension,
      integral_salary: !!worker.integralSalary,
      salary: money(cents(worker.salary)),
    },
    payment: {
      payment_method_id: worker.paymentMethodId,
      ...(worker.bankName
        ? {
            bank_name: worker.bankName,
            account_type: worker.accountType,
            account_number: worker.accountNumber,
          }
        : {}),
    },
    accrued,
    deductions,
  };
}
