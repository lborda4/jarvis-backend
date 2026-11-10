import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { CreatePayrollModule1793600000000 } from '../migrations/1793600000000-CreatePayrollModule';
import { AddPayrollWorkerCodes1794600000000 } from '../migrations/1794600000000-AddPayrollWorkerCodes';
import { PayrollService } from './payroll.service';

interface WorkerRow {
  id: string;
  worker_code: string;
  data: { workerCode: string; firstName: string; salary: string };
}
const url = process.env.PAYROLL_WORKER_CODES_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

// Todas las escrituras quedan en un esquema propio. Cada prueba revierte su
// transacción; la prueba concurrente elimina su esquema al terminar.
integration('códigos persistidos de empleados en PostgreSQL', () => {
  let db: DataSource;
  let runner: QueryRunner;
  let schema: string;
  let committed: boolean;
  const company = randomUUID(),
    other = randomUUID();
  const migration = new AddPayrollWorkerCodes1794600000000();
  function query<T = WorkerRow>(sql: string, params?: unknown[]): Promise<T[]> {
    return db.query<T[]>(sql, params, runner);
  }
  const worker = (identification: string) => ({
    identification,
    firstName: 'Ana',
    surname: 'Pérez',
    salary: '2000000',
    admittanceDate: '2026-01-01',
    contractType: 'INDEFINITE',
    documentTypeId: 3,
    typeWorkerId: 1,
    subTypeWorkerId: 1,
    paymentMethodId: 10,
    address: 'Calle 1',
    municipalityId: 439,
    typeContractId: 1,
  });
  async function insert(
    id: string,
    identification: string,
    tenant = company,
    code?: string,
  ) {
    return (
      await query(
        'INSERT INTO jarvis_payroll_employees(id,company_id,identification,data) VALUES($1,$2,$3,$4) RETURNING *',
        [
          id,
          tenant,
          identification,
          JSON.stringify({
            ...worker(identification),
            ...(code ? { workerCode: code } : {}),
          }),
        ],
      )
    )[0];
  }
  function service() {
    const api = {
      payrollPlanInfo: jest.fn().mockResolvedValue({ docs_left_absolut: 100 }),
      payrollRequest: jest.fn().mockResolvedValue({
        ResponseDian: { IsValid: 'true' },
        cune: 'a'.repeat(96),
      }),
    };
    const scoped = {
      query: (sql: string, params?: unknown[]) =>
        db.query<unknown[]>(sql, params, runner),
      transaction: <T>(work: (manager: EntityManager) => Promise<T>) =>
        runner.manager.transaction(work),
      manager: runner.manager,
    };
    const catalogs = {
      requireCompanyToken: jest.fn().mockResolvedValue('token-de-prueba'),
      getPayrollWorkerCatalogs: jest.fn().mockResolvedValue({
        identifications: [{ id: 3 }],
        workerTypes: [{ id: 1 }],
        contractTypes: [{ key: 'INDEFINITE', id: 1, name: 'Término indefinido', code: '2' }],
        workerSubtypes: [{ id: 1 }],
        paymentMethods: [{ id: 10 }],
      }),
    };
    const plans = {
      withJarvisQuotaLock: <T>(_company: string, work: () => Promise<T>) =>
        work(),
      assertCanCreateDocuments: jest.fn().mockResolvedValue(undefined),
    };
    return {
      payroll: new PayrollService(
        scoped as never,
        catalogs as never,
        api as never,
        plans as never,
      ),
      api,
    };
  }

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      url,
      ssl:
        process.env.PAYROLL_WORKER_CODES_TEST_SSL === '0'
          ? false
          : { rejectUnauthorized: false },
      connectTimeoutMS: 10000,
      synchronize: false,
      migrationsRun: false,
      logging: false,
    });
    await db.initialize();
  }, 30000);
  beforeEach(async () => {
    runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    committed = false;
    schema = `payroll_worker_test_${randomUUID().replaceAll('-', '')}`;
    await query(`CREATE SCHEMA "${schema}"`);
    await query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    await query('CREATE TABLE companies (id uuid PRIMARY KEY)');
    await new CreatePayrollModule1793600000000().up(runner);
    await query('INSERT INTO companies(id) VALUES($1),($2)', [company, other]);
  });
  afterEach(async () => {
    if (!db?.isInitialized) return;
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    await runner?.release();
    if (committed) {
      if (!/^payroll_worker_test_[a-f0-9]{32}$/.test(schema))
        throw new Error('Esquema de prueba inválido');
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    const [remaining] = await db.query<{ exists: boolean }[]>(
      'SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS exists',
      [schema],
    );
    expect(remaining.exists).toBe(false);
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('asigna consecutivos por empresa al crear, también para cargas masivas', async () => {
    await migration.up(runner);
    const first = await insert(randomUUID(), '11111111');
    const second = await insert(randomUUID(), '22222222');
    const ownOther = await insert(randomUUID(), '11111111', other);
    expect([
      first.worker_code,
      second.worker_code,
      ownOther.worker_code,
    ]).toEqual(['EMP001', 'EMP002', 'EMP001']);
    expect(first.data.workerCode).toBe('EMP001');
    expect(second.data.workerCode).toBe('EMP002');
  });
  it('completa empleados existentes y conserva sus datos y códigos únicos previos', async () => {
    const legacy = await insert(randomUUID(), '11111111');
    const coded = await insert(randomUUID(), '22222222', company, 'EMP007');
    const duplicate = await insert(randomUUID(), '33333333', company, 'EMP007');
    await query(
      'UPDATE jarvis_payroll_employees SET updated_at=$2 WHERE id=$1',
      [coded.id, '2026-01-01'],
    );
    await migration.up(runner);
    const rows = await query(
      'SELECT * FROM jarvis_payroll_employees WHERE company_id=$1',
      [company],
    );
    expect(new Set(rows.map((row) => row.worker_code)).size).toBe(3);
    const old = rows.find((row) => row.id === legacy.id)!;
    expect(old.data).toMatchObject({
      firstName: 'Ana',
      salary: '2000000',
      workerCode: old.worker_code,
    });
    expect(rows.find((row) => row.id === coded.id)!.worker_code).toBe('EMP007');
    expect(rows.find((row) => row.id === duplicate.id)!.worker_code).not.toBe(
      'EMP007',
    );
    expect((await insert(randomUUID(), '44444444')).worker_code).toBe('EMP010');
  });
  it('conserva un código personalizado antiguo y lo sigue enviando como identidad persistida', async () => {
    const old = await insert(
      randomUUID(),
      '11111111',
      company,
      'TRABAJADOR-ANTIGUO',
    );
    await migration.up(runner);
    expect(
      (
        await query('SELECT * FROM jarvis_payroll_employees WHERE id=$1', [
          old.id,
        ])
      )[0].worker_code,
    ).toBe('TRABAJADOR-ANTIGUO');
    expect((await insert(randomUUID(), '22222222')).worker_code).toBe('EMP001');
  });
  it('mantiene el código al editar por upsert e ignora códigos enviados por el cliente', async () => {
    await migration.up(runner);
    const { payroll } = service();
    const id = randomUUID();
    const saved = (await payroll.saveEmployee(company, 'actor', id, {
      ...worker('11111111'),
      workerCode: 'EMP999',
    })) as { id: string; workerCode: string };
    expect(saved.workerCode).toBe('EMP001');
    const edited = (await payroll.saveEmployee(company, 'actor', id, {
      ...worker('11111111'),
      firstName: 'Ana María',
      workerCode: 'OTRO',
    })) as { workerCode: string };
    expect(edited.workerCode).toBe('EMP001');
    const boot = (await payroll.bootstrap(company)) as {
      employees: Array<{ id: string; workerCode: string }>;
    };
    expect(boot.employees.find((row) => row.id === id)?.workerCode).toBe(
      'EMP001',
    );
    expect((await insert(randomUUID(), '22222222')).worker_code).toBe('EMP002');
    const changed = (
      await query(
        'WITH changed AS (UPDATE jarvis_payroll_employees SET worker_code=$2 WHERE id=$1 RETURNING *) SELECT * FROM changed',
        [id, 'ALTERADO'],
      )
    )[0];
    expect(changed.worker_code).toBe('EMP001');
    expect(changed.data.workerCode).toBe('EMP001');
  });
  it('no reutiliza el código de un empleado eliminado', async () => {
    await migration.up(runner);
    const first = await insert(randomUUID(), '11111111');
    await query('DELETE FROM jarvis_payroll_employees WHERE id=$1', [first.id]);
    expect((await insert(randomUUID(), '22222222')).worker_code).toBe('EMP002');
  });
  it('continúa después de EMP999 sin truncar el consecutivo', async () => {
    await migration.up(runner);
    await query(
      'INSERT INTO jarvis_payroll_employee_sequences(company_id,last_number) VALUES($1,999)',
      [company],
    );
    expect((await insert(randomUUID(), '11111111')).worker_code).toBe(
      'EMP1000',
    );
  });
  it('revierte la reserva del consecutivo si falla el guardado', async () => {
    await migration.up(runner);
    await insert(randomUUID(), '11111111');
    await query('SAVEPOINT invalid_employee');
    await expect(insert(randomUUID(), '11111111')).rejects.toThrow();
    await query('ROLLBACK TO SAVEPOINT invalid_employee');
    expect((await insert(randomUUID(), '22222222')).worker_code).toBe('EMP002');
  });
  it('guarda el código en el borrador y envía el persistido aunque el borrador sea anterior', async () => {
    await migration.up(runner);
    const { payroll, api } = service();
    const employeeId = randomUUID(),
      documentId = randomUUID();
    await payroll.saveEmployee(
      company,
      'actor',
      employeeId,
      worker('11111111'),
    );
    await query(
      `INSERT INTO jarvis_payroll_settings(company_id,settings) VALUES($1,$2)`,
      [
        company,
        JSON.stringify({
          prefix: 'NE',
          enabled: true,
          environment: 2,
          syncedEnvironment: 2,
        }),
      ],
    );
    await query(
      'INSERT INTO jarvis_payroll_parameters(id,company_id,valid_from,data) VALUES($1,$2,$3,$4)',
      [
        randomUUID(),
        company,
        '2026-01-01',
        JSON.stringify({
          monthlyDays: '30',
          concepts: [{ code: 'salary', kind: 'accrued', active: true }],
        }),
      ],
    );
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
          id: randomUUID(),
          concept: 'salary',
          kind: 'accrued',
          amount: '2000000',
          quantity: '30',
        },
      ],
    };
    await payroll.saveDocument(company, 'actor', documentId, state);
    expect(
      (
        await query<{ snapshot: { workerCode: string } }>(
          'SELECT employee_snapshot AS snapshot FROM jarvis_payroll_documents WHERE id=$1',
          [documentId],
        )
      )[0].snapshot.workerCode,
    ).toBe('EMP001');
    await query(
      `UPDATE jarvis_payroll_documents SET employee_snapshot=employee_snapshot-'workerCode' WHERE id=$1`,
      [documentId],
    );
    expect((await payroll.validate(company, documentId)).valid).toBe(true);
    await payroll.send(company, 'actor', documentId);
    expect(api.payrollRequest).toHaveBeenCalledWith(
      'payroll',
      expect.objectContaining({
        worker_code: 'EMP001',
      }),
      'token-de-prueba',
    );
    const transmission = (
      await query<{
        request: {
          worker_code: string;
          worker: { identification_number: string };
        };
      }>(
        'SELECT request FROM jarvis_payroll_transmissions WHERE document_id=$1',
        [documentId],
      )
    )[0];
    expect(transmission.request.worker_code).toBe('EMP001');
    expect(transmission.request.worker.identification_number).toBe('11111111');
  });
  it('genera códigos distintos con ocho creaciones simultáneas', async () => {
    await migration.up(runner);
    await runner.commitTransaction();
    committed = true;
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        db.transaction(async (manager) => {
          await manager.query(
            `SET LOCAL search_path TO "${schema}", pg_catalog`,
          );
          const [row] = await manager.query<WorkerRow[]>(
            'INSERT INTO jarvis_payroll_employees(id,company_id,identification,data) VALUES($1,$2,$3,$4) RETURNING *',
            [
              randomUUID(),
              company,
              `1234567${index}`,
              JSON.stringify(worker(`1234567${index}`)),
            ],
          );
          return row.worker_code;
        }),
      ),
    );
    expect(created.sort()).toEqual([
      'EMP001',
      'EMP002',
      'EMP003',
      'EMP004',
      'EMP005',
      'EMP006',
      'EMP007',
      'EMP008',
    ]);
  });
  it('conserva los códigos en JSON al revertir la migración', async () => {
    await migration.up(runner);
    const first = await insert(randomUUID(), '11111111');
    await migration.down(runner);
    const [row] = await query(
      'SELECT id,data FROM jarvis_payroll_employees WHERE id=$1',
      [first.id],
    );
    expect(row.data.workerCode).toBe('EMP001');
  });
});
