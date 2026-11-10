import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CreatePayrollModule1793600000000 } from '../migrations/1793600000000-CreatePayrollModule';
import { PayrollService } from './payroll.service';

const url = process.env.PAYROLL_NUMBERING_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('numeración automática de nómina en PostgreSQL aislado', () => {
  const schema = 'payroll_numbering_test_' + randomUUID().replaceAll('-', '');
  const company = randomUUID(),
    otherCompany = randomUUID();
  let admin: DataSource, db: DataSource;
  let identificationSequence = 10000000;
  const api = {
    payrollPlanInfo: jest.fn().mockResolvedValue({ docs_left_absolut: 100 }),
    payrollRequest: jest.fn().mockImplementation(() =>
      Promise.resolve({
        ResponseDian: { IsValid: true },
        cune: 'a'.repeat(96),
      }),
    ),
  };
  const service = () =>
    new PayrollService(
      db,
      {
        requireCompanyToken: jest.fn().mockResolvedValue('test-token'),
        getPayrollWorkerCatalogs: jest.fn().mockResolvedValue({
          paymentMethods: [{ id: 10, code: '10', name: 'Efectivo' }],
        }),
      } as never,
      api as never,
      {
        withJarvisQuotaLock: <T>(_company: string, work: () => Promise<T>) =>
          work(),
        assertCanCreateDocuments: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
  const counter = async (owner = company) =>
    (
      await db.query<{ next_number: string }[]>(
        'SELECT next_number::text FROM jarvis_payroll_settings WHERE company_id=$1',
        [owner],
      )
    )[0].next_number;
  async function draft(owner = company) {
    const id = randomUUID(),
      employeeId = randomUUID();
    const worker = {
      workerCode: 'EMP001',
      identification: String(++identificationSequence),
      firstName: 'Ana',
      surname: 'Pérez',
      salary: '1000',
      admittanceDate: '2026-01-01',
      typeWorkerId: 1,
      subTypeWorkerId: 1,
      documentTypeId: 3,
      paymentMethodId: 10,
      address: 'Calle 1',
      municipalityId: 149,
      typeContractId: 1,
    };
    const state = {
      employeeId,
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
    };
    await db.query(
      'INSERT INTO jarvis_payroll_employees(id,company_id,identification,data) VALUES($1,$2,$3,$4)',
      [employeeId, owner, worker.identification, JSON.stringify(worker)],
    );
    await db.query(
      'INSERT INTO jarvis_payroll_documents(id,company_id,employee_id,state,employee_snapshot,parameter_snapshot,accrued,deductions,net) VALUES($1,$2,$3,$4,$5,$6,1000,0,1000)',
      [
        id,
        owner,
        employeeId,
        JSON.stringify(state),
        JSON.stringify(worker),
        '{}',
      ],
    );
    return id;
  }
  beforeAll(async () => {
    admin = new DataSource({ type: 'postgres', url, ssl: false });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      url,
      ssl: false,
      extra: { options: `-c search_path=${schema}`, max: 12 },
    });
    await db.initialize();
    await db.query('CREATE TABLE companies(id uuid PRIMARY KEY)');
    await db.query('INSERT INTO companies(id) VALUES($1),($2)', [
      company,
      otherCompany,
    ]);
    const runner = db.createQueryRunner();
    try {
      await new CreatePayrollModule1793600000000().up(runner);
    } finally {
      await runner.release();
    }
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  beforeEach(async () => {
    api.payrollRequest.mockReset().mockResolvedValue({
      ResponseDian: { IsValid: true },
      cune: 'a'.repeat(96),
    });
    await db.query(
      'TRUNCATE jarvis_payroll_transmissions,jarvis_payroll_documents,jarvis_payroll_employees,jarvis_payroll_settings,jarvis_payroll_audit CASCADE',
    );
    await service().bootstrap(company);
    await service().bootstrap(otherCompany);
    await db.query(
      `UPDATE jarvis_payroll_settings SET settings=settings || '{"enabled":true,"syncedEnvironment":2}'::jsonb`,
    );
  });
  it('persiste SETP y 1 sin solicitar campos de numeración y no permite cambiarlos desde configuración', async () => {
    expect(
      ((await service().bootstrap(company)).settings as { prefix: string })
        .prefix,
    ).toBe('SETP');
    expect(await counter()).toBe('1');
    await service().saveSettings(company, 'actor', {
      environment: 2,
      enabled: true,
      prefix: 'USUARIO',
      nextNumber: 900,
    });
    expect(
      ((await service().bootstrap(company)).settings as { prefix: string })
        .prefix,
    ).toBe('SETP');
    expect(await counter()).toBe('1');
  });
  it('reserva números únicos en seis envíos simultáneos, persiste el siguiente y continúa tras reiniciar el servicio', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => draft()));
    await Promise.all(ids.map((id) => service().send(company, 'actor', id)));
    const rows = await db.query<{ prefix: string; number: string }[]>(
      'SELECT prefix,number::text FROM jarvis_payroll_documents ORDER BY number',
    );
    expect(rows.map((row) => row.number)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(rows.every((row) => row.prefix === 'SETP')).toBe(true);
    expect(await counter()).toBe('7');
    await service().send(company, 'actor', await draft());
    expect(await counter()).toBe('8');
  });
  it('inicia cada empresa en 1 y conserva el contador al recargar o guardar configuración', async () => {
    await service().send(company, 'actor', await draft());
    await service().send(otherCompany, 'actor', await draft(otherCompany));
    expect(await counter()).toBe('2');
    expect(await counter(otherCompany)).toBe('2');
    await service().bootstrap(company);
    await service().saveSettings(company, 'actor', {
      environment: 2,
      enabled: true,
    });
    expect(await counter()).toBe('2');
  });
  it('reutiliza el mismo número en un rechazo y bloquea reenvíos de solicitudes ambiguas', async () => {
    const id = await draft();
    api.payrollRequest.mockResolvedValueOnce({
      ResponseDian: { IsValid: false },
      cune: null,
    });
    await service().send(company, 'actor', id);
    expect(await counter()).toBe('2');
    await service().send(company, 'actor', id);
    expect(await counter()).toBe('2');
    const requests = await db.query<
      { request: { prefix: string; consecutive: number } }[]
    >('SELECT request FROM jarvis_payroll_transmissions WHERE document_id=$1', [
      id,
    ]);
    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        (row) => row.request.prefix === 'SETP' && row.request.consecutive === 1,
      ),
    ).toBe(true);
    const uncertain = await draft();
    api.payrollRequest.mockRejectedValueOnce(new Error('timeout'));
    await expect(service().send(company, 'actor', uncertain)).rejects.toThrow(
      'No se confirmó',
    );
    expect(await counter()).toBe('3');
    await expect(service().send(company, 'actor', uncertain)).rejects.toThrow(
      'envío pendiente',
    );
    expect(await counter()).toBe('3');
  });
  it('recupera un contador atrasado sin modificar números ni prefijos históricos', async () => {
    const id = await draft();
    await db.query(
      "UPDATE jarvis_payroll_documents SET number=40,prefix='LEGACY',status='REJECTED' WHERE id=$1",
      [id],
    );
    await db.query(
      'UPDATE jarvis_payroll_settings SET next_number=1,settings=settings || \'{"prefix":"LEGACY"}\'::jsonb WHERE company_id=$1',
      [company],
    );
    await service().bootstrap(company);
    expect(await counter()).toBe('41');
    await service().send(company, 'actor', id);
    expect(await counter()).toBe('41');
    const row = (
      await db.query<{ prefix: string; number: string }[]>(
        'SELECT prefix,number::text FROM jarvis_payroll_documents WHERE id=$1',
        [id],
      )
    )[0];
    expect(row).toEqual({ prefix: 'LEGACY', number: '40' });
  });
});
