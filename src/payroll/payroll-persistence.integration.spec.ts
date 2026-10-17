import { randomUUID } from 'node:crypto';
import dataSource from '../config/data-source';
import { PayrollService } from './payroll.service';

// Explicit opt-in: use a test database and a company dedicated to integration tests.
const databaseUrl = process.env.PAYROLL_TEST_DATABASE_URL;
const companyId = process.env.PAYROLL_TEST_COMPANY_ID;
const integration = databaseUrl && companyId ? describe : describe.skip;

integration('persistencia de nómina en PostgreSQL (rollback)', () => {
  it('guarda cargos, empleados y borradores, aísla empresas y conserva el historial', async () => {
    dataSource.setOptions({
      url: databaseUrl,
      synchronize: false,
      migrationsRun: false,
      logging: false,
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const employeeId = randomUUID(),
      secondEmployeeId = randomUUID(),
      documentId = randomUUID(),
      positionId = randomUUID();
    const scoped = {
      query: (...args: any[]) => runner.query(args[0], args[1]),
      manager: runner.manager,
      transaction: (fn: any) => runner.manager.transaction(fn),
    };
    const catalogs = {
      getPayrollWorkerCatalogs: async () => ({
        workerTypes: [{ id: 1 }],
        workerSubtypes: [{ id: 1 }],
        identifications: [{ id: 3 }],
        paymentMethods: [{ id: 1 }],
      }),
    };
    const service = new PayrollService(
      scoped as any,
      catalogs as any,
      {} as any,
      {} as any,
    );
    try {
      await service.savePosition(companyId!, 'integration-test', positionId, {
        code: 'TEST-' + positionId.slice(0, 8),
        name: 'Cargo temporal de prueba',
        salary: '2000000',
        active: true,
      });
      const worker = {
        id: employeeId,
        identification: '99' + String(Date.now()).slice(-10),
        firstName: 'Prueba',
        surname: 'Temporal',
        salary: '2000000',
        admittanceDate: '2199-01-01',
        documentTypeId: 3,
        typeWorkerId: 1,
        subTypeWorkerId: 1,
        contractType: 'INDEFINITE',
        paymentMethodId: 1,
        active: true,
        positionId,
      };
      await service.saveEmployee(
        companyId!,
        'integration-test',
        employeeId,
        worker,
      );
      await service.saveParameters(companyId!, 'integration-test', {
        validFrom: '2199-11-01',
        minimumSalary: '1',
        transportAllowance: '0',
        monthlyDays: '30',
        monthlyHours: '200',
        weeklyHours: '40',
        concepts: [
          {
            code: 'salary',
            name: 'Salario',
            kind: 'accrued',
            base: 'manual',
            active: true,
          },
        ],
      });
      const state = {
        employeeId,
        period: '2199-11',
        startDate: '2199-11-01',
        endDate: '2199-11-30',
        issueDate: '2199-12-01',
        workedDays: '30',
        paymentDates: ['2199-11-30'],
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
      await service.saveDocument(
        companyId!,
        'integration-test',
        documentId,
        state,
      );
      const document = await service.get(companyId!, documentId);
      expect(document.status).toBe('DRAFT');
      expect(document.net).toBe('2000000.00');
      await expect(service.get(randomUUID(), documentId)).rejects.toThrow(
        'no encontrada',
      );
      await service.saveEmployee(companyId!, 'integration-test', employeeId, {
        ...worker,
        salary: '3000000',
      });
      await service.saveDocument(
        companyId!,
        'integration-test',
        documentId,
        state,
      );
      expect(
        (await service.get(companyId!, documentId)).employee_snapshot.salary,
      ).toBe('2000000');
      await service.saveEmployee(
        companyId!,
        'integration-test',
        secondEmployeeId,
        {
          ...worker,
          id: secondEmployeeId,
          identification: '88' + String(Date.now()).slice(-10),
        },
      );
      const groupId = randomUUID();
      const periodRequest = {
        name: 'Prueba de nómina conjunta',
        period: '2199-12',
        periodicity: 'FIRST_HALF' as const,
        employeeIds: [employeeId, secondEmployeeId],
      };
      const created = await service.createPeriod(
        companyId!,
        'integration-test',
        groupId,
        periodRequest,
      );
      expect(created.documentIds).toHaveLength(2);
      const grouped = await runner.query(
        `SELECT state,status,net FROM jarvis_payroll_documents WHERE company_id=$1 AND state->>'payrollGroupId'=$2`,
        [companyId, groupId],
      );
      expect(
        grouped.every(
          (d) =>
            d.state.payrollName === periodRequest.name &&
            d.state.periodicity === 'FIRST_HALF' &&
            d.status === 'DRAFT',
        ),
      ).toBe(true);
      expect(grouped.map((d) => d.net).sort()).toEqual([
        '1000000.00',
        '1500000.00',
      ]);
      expect(
        (
          await service.createPeriod(
            companyId!,
            'integration-test',
            groupId,
            periodRequest,
          )
        ).documentIds.sort(),
      ).toEqual(created.documentIds.sort());
      const failedId = randomUUID(),
        originalSave = service.saveDocument.bind(service);
      let saves = 0;
      const saveSpy = jest
        .spyOn(service, 'saveDocument')
        .mockImplementation(async (...args) => {
          saves++;
          if (saves === 2)
            throw new Error('Fallo simulado del segundo empleado');
          return originalSave(...args);
        });
      await expect(
        service.createPeriod(companyId!, 'integration-test', failedId, {
          ...periodRequest,
          period: '2200-01',
        }),
      ).rejects.toThrow('segundo empleado');
      saveSpy.mockRestore();
      const [{ remaining }] = await runner.query(
        `SELECT count(*)::int AS remaining FROM jarvis_payroll_documents WHERE company_id=$1 AND state->>'payrollGroupId'=$2`,
        [companyId, failedId],
      );
      expect(remaining).toBe(0);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
      const [{ count }] = await dataSource.query(
        'SELECT count(*)::int FROM jarvis_payroll_employees WHERE id=ANY($1::uuid[])',
        [[employeeId, secondEmployeeId]],
      );
      await dataSource.destroy();
      expect(count).toBe(0);
    }
  }, 60000);
});
