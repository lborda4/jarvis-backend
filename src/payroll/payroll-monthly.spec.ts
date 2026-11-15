import { consolidatePayrollMonth, assertMonthlyRevisions, monthlyRevisions, MonthlySource } from './payroll-monthly';
import { buildPayrollPayload } from './payroll-domain';

const worker = { workerCode: 'EMP001', identification: '123', firstName: 'Ana', surname: 'Pérez', admittanceDate: '2026-01-01', salary: '2000', paymentMethodId: 1, typeWorkerId: 1, subTypeWorkerId: 1, documentTypeId: 3, address: 'Calle 1', municipalityId: 439, typeContractId: 1 };
const source = (id: string, half = 1): MonthlySource => ({ id, employee_id: 'employee', status: 'DRAFT', updated_at: '2026-11-01T12:00:00.000Z', employee_snapshot: worker,
  parameter_snapshot: { concepts: [{ code: 'salary', category: 'Salario', kind: 'accrued' }] },
  state: { period: '2026-10', startDate: `2026-10-${half === 1 ? '01' : '16'}`, endDate: `2026-10-${half === 1 ? '15' : '31'}`, issueDate: '2026-10-15', workedDays: '15', workedTime: '15', paymentDates: [`2026-10-${half === 1 ? '15' : '31'}`], lines: [{ id: 'salary', concept: 'salary', kind: 'accrued', quantity: '15', amount: '1000.10', formula: 'old' }] },
});
describe('consolidación mensual de nómina', () => {
  it('envía un cuerpo mensual con ambas quincenas y todas las fechas de pago sin recalcular importes', () => {
    const rows = [source('a'), source('b', 2)];
    const before = JSON.stringify(rows);
    const result = consolidatePayrollMonth('2026-10', rows, 4, '2026-11-12');
    const body = buildPayrollPayload(result.state, result.worker, 9, 'SETP');
    expect(result).toMatchObject({ accrued: '2000.20', deductions: '0.00', net: '2000.20' });
    expect(result.state).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-31', workedDays: '30.00', workedTime: '300', issueDate: '2026-11-12' });
    expect(body).toMatchObject({ payroll_period_id: 4, accrued: { worked_days: 30, salary: '2000.20', accrued_total: '2000.20' }, payment_dates: [{ payment_date: '2026-10-15' }, { payment_date: '2026-10-31' }] });
    expect(result.state.lines.every(line => line.manual && line.formula === undefined)).toBe(true);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('conserva deducciones legales seleccionadas por quincena y acumula arrays con sus descripciones', () => {
    const rows = [source('a'), source('b', 2)];
    rows.forEach(row => { row.state.epsTypeLawDeductionsId = 31; row.state.lines.push({ id: 'eps', concept: 'eps', kind: 'deduction', amount: '10.25', quantity: '1' }, { id: 'loan', concept: 'loan', kind: 'deduction', amount: '20.20', quantity: '1', description: row.id }); });
    const result = consolidatePayrollMonth('2026-10', rows, 4, '2026-11-12');
    expect(buildPayrollPayload(result.state, result.worker, 1, 'SETP').deductions).toMatchObject({ eps_type_law_deductions_id: 31, eps_deduction: '20.50', deductions_total: '60.90', orders: [{ description: 'a', deduction: 20.2 }, { description: 'b', deduction: 20.2 }] });
  });
  it('conserva homologaciones distintas para que el proveedor las valide al enviar', () => {
    const rows = [source('a'), source('b', 2)];
    rows.forEach((row, index) => row.state.lines.push({ id: 'eps', concept: 'eps', kind: 'deduction', quantity: '1', amount: '10', typeLawDeductionsId: index + 1 }));
    const result = consolidatePayrollMonth('2026-10', rows, 4, '2026-11-12');
    const body = buildPayrollPayload(result.state, result.worker, 1, 'SETP', undefined, { validation: 'provider' });
    expect(body.deductions).toMatchObject({ eps_type_law_deductions_id: [1, 2], eps_deduction: '20.00' });
  });
  it('rechaza períodos superpuestos, de otro mes o notas de ajuste', () => {
    expect(() => consolidatePayrollMonth('2026-10', [source('a'), source('b')], 4, '2026-11-12')).toThrow('superpuestos');
    const another = source('a'); another.state.endDate = '2026-11-01';
    expect(() => consolidatePayrollMonth('2026-10', [another], 4, '2026-11-12')).toThrow('mes seleccionado');
    expect(() => consolidatePayrollMonth('2026-10', [{ ...source('a'), original_id: 'original' }], 4, '2026-11-12')).toThrow('originales');
  });
  it('permite una única quincena de un empleado retirado durante el mes sin inventar pagos', () => {
    const row = source('a'); row.employee_snapshot = { ...worker, retirementDate: '2026-10-15', active: false };
    const result = consolidatePayrollMonth('2026-10', [row], 4, '2026-11-12');
    expect(result.state.workedDays).toBe('15.00');
    expect(result.state.workedTime).toBe('285');
    expect(result.accrued).toBe('1000.10');
  });
  it('valida revisiones y conjunto completo de fuentes independientemente del orden', () => {
    const rows = [source('a'), source('b', 2)];
    expect(() => assertMonthlyRevisions(rows, monthlyRevisions([...rows].reverse()))).not.toThrow();
    expect(() => assertMonthlyRevisions(rows, monthlyRevisions(rows.slice(0, 1)))).toThrow('cambió');
    expect(() => assertMonthlyRevisions(rows, [{ id: 'a', updatedAt: '2026-10-01' }])).toThrow('cambió');
    expect(() => assertMonthlyRevisions([{ ...rows[0], sourceVersion: 'changed' }], monthlyRevisions([{ ...rows[0], sourceVersion: 'old' }]))).toThrow('cambió');
  });
  it('rechaza empleados distintos y conserva los días para validación del proveedor', () => {
    expect(() => consolidatePayrollMonth('2026-10', [source('a'), { ...source('b', 2), employee_id: 'other' }], 4, '2026-11-12')).toThrow('mismo empleado');
    const a = source('a'), b = source('b', 2); a.state.workedDays = '20';
    expect(consolidatePayrollMonth('2026-10', [a, b], 4, '2026-11-12').state.workedDays).toBe('35.00');
  });
});

