import { dayOvertimeErrors, overtimeDefinition } from './payroll-overtime';
import { payrollWorkedTime } from './payroll-employment';
import { employeeBankErrors, workerPaymentType } from './payroll-employee-payment';

export const PAYROLL_TYPE_DOCUMENT_ID = 9;

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
  startTime?: string;
  endTime?: string;
  overtimeSurchargeId?: number;
  type?: number;
  formula?: string;
  manual?: boolean;
  mapping?: string;
  typeLawDeductionsId?: number;
  description?: string;
  publicSanction?: string;
  privateSanction?: string;
}
export function payrollStructuredDeductionKind(key: string) {
  if (key === 'loan' || key === 'orders') return 'orders'
  if (key === 'labor_union' || key === 'sanctions') return key
  return undefined
}

export function payrollStructuredDeductionErrors(line: PayrollLine): string[] {
  const kind = payrollStructuredDeductionKind(line.mapping ?? line.concept)
  if (!kind) return []
  const errors: string[] = []
  try {
    if (line.kind !== 'deduction') errors.push('La naturaleza de la deducción es incorrecta.')
    if (kind === 'labor_union' && (cents(line.percentage ?? '') > 10000n)) errors.push('El porcentaje sindical debe estar entre 0 y 100.')
    if (kind === 'orders' && !line.description?.trim()) errors.push('Ingresa la descripción de la libranza.')
    if (kind === 'sanctions') {
      const total = cents(line.publicSanction || '0') + cents(line.privateSanction || '0')
      if (total <= 0n) errors.push('Ingresa el valor de la sanción pública o privada.')
      if (total !== cents(line.amount)) errors.push('El total de sanciones debe coincidir con sus valores público y privado.')
    }
  } catch {
    errors.push(kind === 'labor_union' ? 'Ingresa un porcentaje sindical entre 0 y 100 con máximo dos decimales.' : 'Revisa los valores de la deducción.')
  }
  return errors
}

export function buildPayrollStructuredDeductions(lines: PayrollLine[]) {
  const result: Record<string, Array<Record<string, string | number>>> = {}
  for (const line of lines) {
    const kind = payrollStructuredDeductionKind(line.mapping ?? line.concept)
    if (!kind) continue
    const errors = payrollStructuredDeductionErrors(line)
    if (errors.length) throw new Error(errors.join(' '))
    const payment = Number(money(cents(line.amount)))
    const row: Record<string, string | number> = kind === 'labor_union'
      ? { percentage: Number(line.percentage), deduction: payment }
      : kind === 'orders' ? { description: line.description!.trim(), deduction: payment }
      : {
          ...(line.publicSanction ? { public_sanction: Number(money(cents(line.publicSanction))) } : {}),
          ...(line.privateSanction ? { private_sanction: Number(money(cents(line.privateSanction))) } : {}),
        }
    ;(result[kind] ??= []).push(row)
  }
  return result
}


export function payrollArrayDeductionKind(key: string) {
  if (key === 'third_party_payments' || key === 'third_party_payment_deduction') return 'third_party_payments'
  if (key === 'advance' || key === 'advances') return 'advances'
  if (key === 'other_deduction' || key === 'other_deductions') return 'other_deductions'
  return undefined
}

export function payrollScalarDeductionField(key: string) {
  const fields: Record<string, string> = {
    voluntary: 'voluntary_pension', voluntary_pension: 'voluntary_pension',
    withholding: 'withholding_at_source', withholding_at_source: 'withholding_at_source',
    garnishment: 'tax_liens', tax_liens: 'tax_liens', refund_deduction: 'refund', refund: 'refund',
    afc: 'afc', cooperative: 'cooperative', supplementary_plan: 'supplementary_plan', education: 'education', debt: 'debt',
  }
  return Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined
}

export function payrollValueDeductionErrors(line: PayrollLine): string[] {
  if (line.kind !== 'deduction') return []
  const key = line.mapping ?? line.concept
  if (!payrollArrayDeductionKind(key) && !payrollScalarDeductionField(key)) return []
  try {
    cents(line.amount)
    if (payrollArrayDeductionKind(key) === 'other_deductions' && line.description !== undefined && typeof line.description !== 'string')
      return ['Revisa la descripción de la deducción.']
    return []
  } catch { return ['Ingresa un valor de deducción válido con máximo dos decimales.'] }
}

export function buildPayrollValueDeductions(lines: PayrollLine[]) {
  const result: Record<string, number | Array<Record<string, string | number>>> = {}
  const scalarAmounts: Record<string, bigint> = {}
  for (const line of lines) {
    if (line.kind !== 'deduction') continue
    const key = line.mapping ?? line.concept
    const array = payrollArrayDeductionKind(key)
    const scalar = payrollScalarDeductionField(key)
    if (!array && !scalar) continue
    const errors = payrollValueDeductionErrors(line)
    if (errors.length) throw new Error(errors.join(' '))
    const amount = cents(line.amount)
    if (array) {
      const field = array === 'third_party_payments' ? 'third_party_payment' : array === 'advances' ? 'advance' : 'other_deduction'
      const row: Record<string, string | number> = { [field]: Number(money(amount)) }
      if (array === 'other_deductions' && line.description?.trim()) row.description_deduction = line.description.trim()
      const bucket = (result[array] ??= []) as Array<Record<string, string | number>>
      bucket.push(row)
    } else scalarAmounts[scalar!] = (scalarAmounts[scalar!] ?? 0n) + amount
  }
  for (const [field, amount] of Object.entries(scalarAmounts)) result[field] = Number(money(amount))
  return result
}


export interface PayrollInput {
  period: string;
  startDate: string;
  endDate: string;
  issueDate: string;
  workedDays: string;
  lines: PayrollLine[];
  noteType?: number;
  notes?: string;
  headNote?: string;
  footNote?: string;
  workedTime?: string;
  paymentDates?: string[];
  payrollPeriodId?: number;
  epsTypeLawDeductionsId?: number;
  pensionTypeLawDeductionsId?: number;
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
  paymentMethodType?: 'cash' | 'transfer';
  typeWorkerId: number;
  subTypeWorkerId: number;
  documentTypeId: number;
  highRiskPension?: boolean;
  integralSalary?: boolean;
  bankName?: string;
  accountType?: string;
  accountNumber?: string;
  address?: string;
  municipalityId?: number;
  typeContractId?: number;
  workerCode?: string;
}
export const VERIFIED_CONCEPTS = [
  'salary',
  'transportation_allowance',
  'eps',
  'pension',
  'solidarity',
  'subsistence',
  'labor_union',
  'sanctions',
  'loan',
  'orders',
  'third_party_payment_deduction', 'third_party_payments', 'advance', 'advances', 'other_deduction', 'other_deductions',
  'voluntary', 'voluntary_pension', 'withholding', 'withholding_at_source', 'garnishment', 'tax_liens',
  'afc', 'cooperative', 'supplementary_plan', 'education', 'refund_deduction', 'refund', 'debt',
  'overtime_day',
  'overtime_night',
  'disability',
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
  if (employee) {
    try {
      payrollWorkedTime(state.endDate, employee);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Revisa el tiempo laborado.');
    }
  }
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
  if (!Array.isArray(state.lines) || (transmission && !state.lines.length))
    errors.push('Agrega al menos un devengado.');
  else if (state.lines.length) {
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
        (['eps', 'pension', 'solidarity', 'subsistence'].includes(l.mapping ?? l.concept) || Boolean(payrollStructuredDeductionKind(l.mapping ?? l.concept)) || Boolean(payrollArrayDeductionKind(l.mapping ?? l.concept)) || Boolean(payrollScalarDeductionField(l.mapping ?? l.concept)))
          ? l.kind !== 'deduction'
          : VERIFIED_CONCEPTS.includes(l.mapping ?? l.concept) &&
            l.kind !== 'accrued',
      )
    )
      errors.push('La naturaleza de un concepto es incorrecta.');
    for (const line of state.lines as PayrollLine[]) {
      errors.push(...dayOvertimeErrors(line, state.period));
      errors.push(...payrollStructuredDeductionErrors(line));
      errors.push(...payrollValueDeductionErrors(line));
      if ((line.mapping ?? line.concept) === 'disability') {
        if (!Number.isSafeInteger(line.type) || line.type! < 1)
          errors.push('Selecciona el tipo de incapacidad de NextPyme.');
        if (!validDate(line.startDate ?? '') || !validDate(line.endDate ?? '') || line.startDate! > line.endDate! || line.startDate?.slice(0, 7) !== state.period || line.endDate?.slice(0, 7) !== state.period)
          errors.push('Revisa las fechas de la incapacidad dentro del mes de la nómina.');
        if (!Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 31)
          errors.push('Revisa los días de incapacidad.');
      }
      try {
        if (cents(line.quantity) < 0n) errors.push('Cantidad inválida.');
        if (line.percentage !== undefined && cents(line.percentage) > 10000n)
          errors.push('Porcentaje fuera de rango.');
        const deduction = line.mapping ?? line.concept;
        if (transmission && ['eps', 'pension', 'solidarity', 'subsistence'].includes(deduction)) {
          const id =
            line.typeLawDeductionsId ??
            (deduction === 'eps'
              ? state.epsTypeLawDeductionsId
              : deduction === 'pension' ? state.pensionTypeLawDeductionsId : undefined);
          if (!Number.isSafeInteger(id) || id! < 1)
            errors.push(
              `Completa el código de deducción legal de ${deduction} en NextPyme.`,
            );
        }
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
  if (transmission && employee) errors.push(...employeeBankErrors(employee));
  if (transmission) {
    if (!employee?.workerCode?.trim())
      errors.push('El empleado no tiene código asignado. Actualiza el empleado antes de enviar.');
    if (!employee?.address?.trim())
      errors.push('Completa la dirección del empleado.');
    if (
      !Number.isSafeInteger(employee?.municipalityId) ||
      employee!.municipalityId! < 1
    )
      errors.push('Selecciona el municipio del empleado en NextPyme.');
    if (
      !Number.isSafeInteger(employee?.typeContractId) ||
      employee!.typeContractId! < 1
    )
      errors.push('Completa el código de tipo de contrato de NextPyme.');
    if (
      !Number.isSafeInteger(state.payrollPeriodId) ||
      state.payrollPeriodId! < 1
    )
      errors.push('Completa el código de período de nómina de NextPyme.');
    if (
      !Array.isArray(state.paymentDates) ||
      !state.paymentDates.length ||
      state.paymentDates.some((date) => !validDate(date))
    )
      errors.push('Completa las fechas de pago de la nómina.');
  }
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
  const amounts: Record<string, bigint> = {};
  const lawIds: Record<string, number | undefined> = {};
  const lawFields = {
    eps: ['eps_type_law_deductions_id', 'eps_deduction'],
    pension: ['pension_type_law_deductions_id', 'pension_deduction'],
    solidarity: ['fondossp_type_law_deductions_id', 'fondosp_deduction_SP'],
    subsistence: ['fondossp_sub_type_law_deductions_id', 'fondosp_deduction_sub'],
  };
  for (const line of state.lines) {
    const key = line.mapping ?? line.concept;
    amounts[key] = (amounts[key] ?? 0n) + cents(line.amount);
    const selectedLawId = line.typeLawDeductionsId ?? (key === 'eps' ? state.epsTypeLawDeductionsId : key === 'pension' ? state.pensionTypeLawDeductionsId : undefined);
    if (key in lawFields && selectedLawId !== undefined) {
      if (lawIds[key] !== undefined && lawIds[key] !== selectedLawId)
        throw new Error(
          'No mezcles códigos de deducción legal para el mismo concepto.',
        );
      lawIds[key] = selectedLawId;
    }
  }
  const total = totals(state.lines);
  const deductions: Record<string, string | number | Array<Record<string, string | number>>> = {
    deductions_total: total.deductions,
    ...buildPayrollStructuredDeductions(state.lines),
    ...buildPayrollValueDeductions(state.lines),
  };
  for (const [key, [idField, amountField]] of Object.entries(lawFields)) {
    if (amounts[key] === undefined) continue;
    const id = lawIds[key];
    if (!Number.isSafeInteger(id) || id! < 1)
      throw new Error(
        `Completa el código de deducción legal de ${key} en NextPyme.`,
      );
    deductions[amountField] = money(amounts[key]);
    deductions[idField] = id!;
  }
  const overtimeMap = new Map<string, Array<{ start_time: string; end_time: string; quantity: number; percentage: number; payment: string }>>();
  for (const line of state.lines) {
    const key = line.mapping ?? line.concept;
    const definition = overtimeDefinition(key);
    if (!definition) continue;
    const bucket = overtimeMap.get(definition.bodyKey) ?? [];
    bucket.push({
      start_time: line.startTime!,
      end_time: line.endTime!,
      quantity: Number(line.quantity),
      percentage: line.overtimeSurchargeId!,
      payment: money(cents(line.amount)),
    });
    overtimeMap.set(definition.bodyKey, bucket);
  }
  const disabilities = state.lines.filter(line => (line.mapping ?? line.concept) === 'disability').map(line => ({
    start_date: line.startDate!, end_date: line.endDate!, quantity: Number(line.quantity),
    type: line.type!, payment: money(cents(line.amount)),
  }));
  const accruedPayload: Record<string, string | number | Array<{ start_time: string; end_time: string; quantity: number; percentage: number; payment: string }> | typeof disabilities> = {
    salary: money(amounts.salary ?? 0n),
    worked_days: Number(state.workedDays),
    accrued_total: total.accrued,
  };
  if (amounts.transportation_allowance !== undefined) {
    accruedPayload.transportation_allowance = money(amounts.transportation_allowance);
  }
  if (disabilities.length) accruedPayload.work_disabilities = disabilities;
  for (const [key, rows] of overtimeMap.entries()) {
    accruedPayload[key] = rows;
  }
  return {
    type_document_id: predecessor ? 10 : PAYROLL_TYPE_DOCUMENT_ID,
    ...(predecessor ? { type_note: state.noteType, predecessor } : {}),
    consecutive: number,
    prefix,
    notes: state.notes ?? '',
    head_note: state.headNote ?? '',
    foot_note: state.footNote ?? '',
    novelty: { novelty: false, uuidnov: predecessor ? null : '' },
    sendmail: false,
    sendmailtome: false,
    worker_code: worker.workerCode!.trim(),
    payroll_period_id: state.payrollPeriodId!,
    payment_dates: state.paymentDates!.map((payment_date) => ({
      payment_date,
    })),
    period: {
      admision_date: worker.admittanceDate,
      settlement_start_date: state.startDate,
      settlement_end_date: state.endDate,
      worked_time: payrollWorkedTime(state.endDate, worker),
      issue_date: state.issueDate,
    },
    worker: {
      type_worker_id: worker.typeWorkerId,
      sub_type_worker_id: worker.subTypeWorkerId,
      payroll_type_document_identification_id: worker.documentTypeId,
      identification_number: worker.identification,
      surname: worker.surname,
      first_name: worker.firstName,
      middle_name: worker.secondName?.trim() || null,
      second_surname: worker.secondSurname?.trim() || null,
      address: worker.address!,
      municipality_id: worker.municipalityId!,
      type_contract_id: worker.typeContractId!,
      high_risk_pension: false,
      integral_salarary: !!worker.integralSalary,
      salary: money(cents(worker.salary)),
    },
    payment: {
      payment_method_id: worker.paymentMethodId,
      ...(workerPaymentType(worker) !== 'cash' && worker.bankName
        ? {
            bank_name: worker.bankName.trim(),
            account_type: worker.accountType?.trim().toUpperCase(),
            account_number: worker.accountNumber?.trim(),
          }
        : {}),
    },
    accrued: accruedPayload,
    deductions,
  };
}
