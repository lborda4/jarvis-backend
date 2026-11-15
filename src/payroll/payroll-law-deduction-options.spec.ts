import { payrollLawOptionsForConcept } from './payroll-law-deduction-options'

const rows = [
  { id: 11, code: '1', name: 'Salud Tarifa (12.5%) Trabajador' },
  { id: 12, code: '2', name: 'Salud Tarifa (12.5%) Trabajador' },
  { id: 31, code: '3', name: 'Salud Sal<10SMLV Tarifa (4%) Trabajador' },
  { id: 41, code: '4', name: 'Salud Sal<10SMLV Tarifa (4%) Empleador' },
  { id: 51, code: '5', name: 'Pensión Tarifa (16%) Trabajador' },
  { id: 61, code: '6', name: 'Pensión Tarifa (16%) Empleador' },
  { id: 71, code: '7', name: 'Pension Alto Riesgo Tarifa (26%) Trabajador' },
  { id: 81, code: '8', name: 'Pension Alto Riesgo Tarifa (26%) Empleador' },
  { id: 91, code: '9', name: 'Fondo de Solidaridad Empleado' },
]

it.each([
  ['eps', [11, 12, 31, 41]], ['pension', [51, 61, 71, 81]],
  ['solidarity', [91]], ['subsistence', [91]],
] as const)('muestra únicamente las opciones de %s manteniendo sus IDs', (concept, ids) => {
  expect(payrollLawOptionsForConcept(rows, concept).map(row => row.id)).toEqual(ids)
})

it('separa subsistencia cuando NextPyme devuelve un tipo específico', () => {
  const extended = [...rows, { id: 92, code: '10', name: 'Fondo de Subsistencia' }]
  expect(payrollLawOptionsForConcept(extended, 'subsistence').map(row => row.id)).toEqual([92])
  expect(payrollLawOptionsForConcept(extended, 'solidarity').map(row => row.id)).toEqual([91])
})

it('usa el código de catálogo si el nombre no identifica la categoría', () => {
  const master = [{ id: 700, code: '03', name: 'Tarifa trabajador' }, { id: 800, code: '05', name: 'Tarifa trabajador' }]
  expect(payrollLawOptionsForConcept(master, 'eps').map(row => row.id)).toEqual([700])
  expect(payrollLawOptionsForConcept(master, 'pension').map(row => row.id)).toEqual([800])
})

it('no ofrece tipos desconocidos ni reutiliza salud o pensión como fondos', () => {
  expect(payrollLawOptionsForConcept(rows.slice(0, 8), 'subsistence')).toEqual([])
  expect(payrollLawOptionsForConcept([{ id: 99, name: 'Sin clasificar' }], 'eps')).toEqual([])
  expect(payrollLawOptionsForConcept(rows, 'loan')).toEqual([])
})
