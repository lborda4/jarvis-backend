import { PayrollService } from './payroll.service';
import { buildPayrollPayload, type PayrollWorker } from './payroll-domain';

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
  paymentMethodId: 420,
  bankName: ' Banco Ejemplo ',
  accountType: ' AHORROS ',
  accountNumber: ' 001234 ',
  address: 'Calle 1',
  municipalityId: 149,
  typeContractId: 1,
};
const state = {
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
      kind: 'accrued' as const,
      amount: '1000',
      quantity: '30',
    },
  ],
};
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
      contractTypes: [{ key: 'INDEFINITE', id: 1, name: 'Término indefinido', code: '2' }],
      workerSubtypes: [{ id: 1 }],
      identifications: [{ id: 3 }],
      paymentMethods: [
        { id: 100, name: 'Efectivo', code: '10' },
        { id: 420, name: 'Transferecia Crédito', code: '30' },
      ],
    }),
  };
  const service = new PayrollService(
    db as never,
    catalogs as never,
    {} as never,
    {} as never,
  );
  return { service, query, catalogs, stored: () => stored! };
}
it('guarda los datos bancarios y los incluye en payment con las claves de NextPyme', async () => {
  const { service, stored, catalogs } = setup();
  await service.saveEmployee('company-a', 'actor', employee.id, employee);
  expect(catalogs.getPayrollWorkerCatalogs).toHaveBeenCalledWith('company-a');
  expect(stored()).toMatchObject({
    paymentMethodType: 'transfer',
    bankName: 'Banco Ejemplo',
    accountType: 'AHORROS',
    accountNumber: '001234',
  });
  expect(buildPayrollPayload(state, stored(), 1, 'NE').payment).toEqual({
    payment_method_id: 420,
    bank_name: 'Banco Ejemplo',
    account_type: 'AHORROS',
    account_number: '001234',
  });
});
it('permite efectivo sin cuenta y elimina datos bancarios anteriores del guardado y envío', async () => {
  const { service, stored } = setup();
  await service.saveEmployee('company-a', 'actor', employee.id, {
    ...employee,
    paymentMethodId: 100,
    highRiskPension: true,
    accountType: 'invalido',
    accountNumber: 123,
  });
  expect(stored()).toMatchObject({
    paymentMethodType: 'cash',
    highRiskPension: false,
    bankName: '',
    accountType: '',
    accountNumber: '',
  });
  expect(buildPayrollPayload(state, stored(), 1, 'NE').payment).toEqual({
    payment_method_id: 100,
  });
});
it.each([
  { bankName: '' },
  { bankName: '   ' },
  { accountType: '' },
  { accountType: 'OTRO' },
  { accountNumber: '' },
  { accountNumber: 'abc123' },
  { accountNumber: 123 },
  { paymentMethodType: 'cash', bankName: '' },
])(
  'rechaza consignación incompleta antes de escribir sin confiar en el tipo enviado: %j',
  async (fields) => {
    const { service, query } = setup();
    await expect(
      service.saveEmployee('company-a', 'actor', employee.id, {
        ...employee,
        ...fields,
      }),
    ).rejects.toThrow(/banco|cuenta/);
    expect(query).not.toHaveBeenCalled();
  },
);
it('acepta CORRIENTE y no aplica reglas de cuenta al efectivo sin datos bancarios', async () => {
  const { service, stored } = setup();
  await service.saveEmployee('company-a', 'actor', employee.id, {
    ...employee,
    accountType: 'CORRIENTE',
  });
  expect(stored().accountType).toBe('CORRIENTE');
  await service.saveEmployee('company-a', 'actor', employee.id, {
    ...employee,
    paymentMethodId: 100,
    bankName: undefined,
    accountType: undefined,
    accountNumber: undefined,
  });
  expect(stored().bankName).toBe('');
});
