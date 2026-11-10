import {
  payrollContractOptions,
  resolvePayrollContractId,
} from '../integration/jarvis/helpers/payroll-contract-types.helper';
import { PayrollService } from './payroll.service';
import { buildPayrollPayload, type PayrollWorker } from './payroll-domain';

const rows = [
  { id: 91, name: 'Término Fijo', code: '1' },
  { id: 273, name: 'Término Indefinido', code: '2' },
  { id: 303, name: 'Duración de la obra o labor', code: '3' },
  { id: 404, name: 'Aprendizaje', code: '4' },
  { id: 505, name: 'Otro', code: '5' },
];
const contractTypes = payrollContractOptions(rows);
it('homologa los cinco tipos internos por nombre y conserva los IDs reales, distintos del código', () => {
  expect(contractTypes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: 'FIXED', id: 91 }),
      expect.objectContaining({ key: 'INDEFINITE', id: 273 }),
      expect.objectContaining({ key: 'WORK', id: 303 }),
      expect.objectContaining({ key: 'APPRENTICE', id: 404 }),
      expect.objectContaining({ key: 'OCCASIONAL', id: 505 }),
    ]),
  );
  expect(resolvePayrollContractId('INDEFINITE', contractTypes)).toBe(273);
});
it('reconoce tildes, mayúsculas, espacios y nombres de contrato sin adivinar por códigos', () => {
  expect(
    payrollContractOptions([
      { id: 12, name: ' CONTRATO A TÉRMINO INDEFINIDO ' },
    ])[0]?.key,
  ).toBe('INDEFINITE');
  expect(
    payrollContractOptions([{ id: 12, name: 'Sin identificar', code: '2' }]),
  ).toEqual([]);
});
it('bloquea homologaciones ausentes o ambiguas y un ID que corresponde a otro contrato', () => {
  expect(() => resolvePayrollContractId('INDEFINITE', [])).toThrow(
    'no está homologado',
  );
  const ambiguous = payrollContractOptions([
    ...rows,
    { id: 274, name: 'Indefinido', code: '2' },
  ]);
  expect(() => resolvePayrollContractId('INDEFINITE', ambiguous)).toThrow(
    'no está homologado',
  );
  expect(() =>
    resolvePayrollContractId('INDEFINITE', contractTypes, 91),
  ).toThrow('no corresponde');
});
function setup() {
  let stored: PayrollWorker | null = null;
  const query = jest.fn((sql: string, params: unknown[]) => {
    if (sql.startsWith('INSERT INTO jarvis_payroll_employees')) {
      stored = JSON.parse(params[3] as string) as PayrollWorker;
      return Promise.resolve([{ id: 'employee', workerCode: 'EMP001' }]);
    }
    return Promise.resolve([]);
  });
  const db = {
    transaction: (fn: (manager: { query: typeof query }) => Promise<unknown>) =>
      fn({ query }),
  };
  const catalogs = {
    getPayrollWorkerCatalogs: jest.fn().mockResolvedValue({
      workerTypes: [{ id: 1 }],
      workerSubtypes: [{ id: 1 }],
      identifications: [{ id: 3 }],
      paymentMethods: [{ id: 10, code: '10', name: 'Efectivo' }],
      contractTypes,
    }),
  };
  return {
    service: new PayrollService(
      db as never,
      catalogs as never,
      {} as never,
      {} as never,
    ),
    catalogs,
    query,
    stored: () => stored!,
  };
}
const employee = {
  id: 'employee',
  workerCode: 'EMP001',
  identification: '12345678',
  firstName: 'Ana',
  surname: 'Pérez',
  contractType: 'INDEFINITE',
  admittanceDate: '2026-01-01',
  salary: '1000',
  typeWorkerId: 1,
  subTypeWorkerId: 1,
  documentTypeId: 3,
  paymentMethodId: 10,
  address: 'Calle 1',
  municipalityId: 149,
};
it('guarda el contrato homologado incluso en clientes anteriores que no enviaban el ID y lo usa en el body de nómina', async () => {
  const { service, stored, catalogs } = setup();
  await service.saveEmployee('company-a', 'actor', employee.id, employee);
  expect(catalogs.getPayrollWorkerCatalogs).toHaveBeenCalledWith('company-a');
  expect(stored()).toMatchObject({
    contractType: 'INDEFINITE',
    typeContractId: 273,
  });
  const payload = buildPayrollPayload(
    {
      period: '2026-10',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      issueDate: '2026-11-01',
      workedDays: '30',
      payrollPeriodId: 4,
      paymentDates: ['2026-10-31'],
      lines: [
        {
          id: 'salary',
          concept: 'salary',
          kind: 'accrued',
          amount: '1000',
          quantity: '30',
        },
      ],
    },
    stored(),
    1,
    'NE',
  );
  expect(payload.worker.type_contract_id).toBe(273);
});
it('rechaza IDs cruzados antes de guardar y permite cambiar de contrato con el ID correspondiente', async () => {
  const { service, stored, query } = setup();
  await expect(
    service.saveEmployee('company-a', 'actor', employee.id, {
      ...employee,
      typeContractId: 91,
    }),
  ).rejects.toThrow('no corresponde');
  expect(query).not.toHaveBeenCalled();
  await service.saveEmployee('company-a', 'actor', employee.id, {
    ...employee,
    contractType: 'FIXED',
    typeContractId: 91,
  });
  expect(stored().typeContractId).toBe(91);
});
it('no guarda si NextPyme no devuelve una homologación para el contrato elegido', async () => {
  const { service, catalogs, query } = setup();
  catalogs.getPayrollWorkerCatalogs.mockResolvedValueOnce({
    workerTypes: [{ id: 1 }],
    workerSubtypes: [{ id: 1 }],
    identifications: [{ id: 3 }],
    paymentMethods: [{ id: 10 }],
    contractTypes: [],
  });
  await expect(
    service.saveEmployee('company-a', 'actor', employee.id, employee),
  ).rejects.toThrow('no está homologado');
  expect(query).not.toHaveBeenCalled();
});
