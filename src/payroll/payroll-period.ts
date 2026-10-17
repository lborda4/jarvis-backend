export type PayrollPeriodicity = 'FIRST_HALF' | 'SECOND_HALF' | 'MONTHLY';
export interface CreatePayrollPeriodRequest {
  name: string;
  period: string;
  periodicity: PayrollPeriodicity;
  employeeIds: string[];
}
export const PAYROLL_PERIODICITY_LABELS: Record<PayrollPeriodicity, string> = {
  FIRST_HALF: 'Primera quincena',
  SECOND_HALF: 'Segunda quincena',
  MONTHLY: 'Mensual',
};
export function payrollPeriodBounds(
  period: string,
  periodicity: PayrollPeriodicity,
) {
  if (!/^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])$/.test(period ?? ''))
    throw new Error('Selecciona un mes y un año válidos.');
  if (!Object.hasOwn(PAYROLL_PERIODICITY_LABELS, periodicity))
    throw new Error('Selecciona la periodicidad de la nómina.');
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDate: `${period}-${periodicity === 'SECOND_HALF' ? '16' : '01'}`,
    endDate: `${period}-${periodicity === 'FIRST_HALF' ? '15' : lastDay}`,
  };
}
export function validatePayrollPeriod(
  request: CreatePayrollPeriodRequest,
): string[] {
  const errors: string[] = [];
  if (typeof request?.name !== 'string' || !request.name.trim())
    errors.push('El nombre de la nómina es obligatorio.');
  else if (request.name.trim().length > 150)
    errors.push('El nombre no debe superar 150 caracteres.');
  try {
    payrollPeriodBounds(request?.period, request?.periodicity);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Revisa el período.');
  }
  if (!Array.isArray(request?.employeeIds) || !request.employeeIds.length)
    errors.push('Selecciona al menos un empleado para la nómina.');
  else {
    if (request.employeeIds.length > 1000)
      errors.push('Puedes incluir hasta 1.000 empleados por nómina.');
    if (new Set(request.employeeIds).size !== request.employeeIds.length)
      errors.push('No repitas empleados en la nómina.');
    if (
      request.employeeIds.some(
        (id) =>
          typeof id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ),
      )
    )
      errors.push('Hay empleados con identificación interna inválida.');
  }
  return errors;
}
