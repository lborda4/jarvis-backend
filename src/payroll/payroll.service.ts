import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { PlanSubscriptionService } from '../plan/plan-subscription.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { ElectronicDocumentType } from '../electronic-document/enums/electronic-document-type.enum';
import { NextPymeMasterCatalogService } from '../integration/jarvis/nextpyme/nextpyme-master-catalog.service';
import { NextPymeApiClient } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { parseDianValidationResult } from '../integration/jarvis/nextpyme/nextpyme-dian-validation.helper';
import {
  buildPayrollPayload,
  cents,
  totals,
  validDate,
  validatePayroll,
} from './payroll-domain';
import { prorate } from './payroll-domain';
import { payrollPeriodBounds, validatePayrollPeriod } from './payroll-period';
import type { CreatePayrollPeriodRequest } from './payroll-period';
import { payrollCune, payrollFiles } from './payroll-response';
import { collectRecords } from '../integration/jarvis/nextpyme/nextpyme-record-scan.helper';

@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DataSource,
    private readonly catalogs: NextPymeMasterCatalogService,
    private readonly api: NextPymeApiClient,
    private readonly plans: PlanSubscriptionService,
  ) {}
  private async audit(
    manager: EntityManager,
    company: string,
    actor: string,
    action: string,
    id?: string,
  ) {
    await manager.query(
      'INSERT INTO jarvis_payroll_audit(id,company_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), company, actor, action, id ?? null],
    );
  }
  workerCatalogs(company: string) {
    return this.catalogs.getPayrollWorkerCatalogs(company);
  }
  async bootstrap(company: string) {
    const [employees, positions, parameters, settings] = await Promise.all([
      this.db.query(
        "SELECT id, data, active FROM jarvis_payroll_employees WHERE company_id=$1 ORDER BY data->>'firstName'",
        [company],
      ),
      this.db.query(
        'SELECT * FROM jarvis_payroll_positions WHERE company_id=$1 ORDER BY name',
        [company],
      ),
      this.db.query(
        'SELECT id, valid_from::text AS "validFrom", data FROM jarvis_payroll_parameters WHERE company_id=$1 ORDER BY valid_from DESC',
        [company],
      ),
      this.db.query(
        'SELECT settings, next_number::text AS "nextNumber" FROM jarvis_payroll_settings WHERE company_id=$1',
        [company],
      ),
    ]);
    return {
      employees: employees.map((e: any) => ({
        ...e.data,
        id: e.id,
        active: e.active,
      })),
      positions,
      parameters,
      settings: settings[0]?.settings ?? {
        environment: 2,
        prefix: 'NE',
        enabled: false,
      },
      nextNumber: settings[0]?.nextNumber ?? '1',
    };
  }
  async saveEmployee(company: string, actor: string, id: string, data: any) {
    if (
      !data ||
      !/^\d{5,20}$/.test(data.identification ?? '') ||
      !data.firstName?.trim() ||
      !data.surname?.trim() ||
      !validDate(data.admittanceDate)
    )
      throw new BadRequestException(
        'Completa identificación, nombres y fecha de ingreso.',
      );
    if (
      !['INDEFINITE', 'FIXED', 'WORK', 'APPRENTICE', 'OCCASIONAL'].includes(
        data.contractType,
      )
    )
      throw new BadRequestException('Selecciona un tipo de contrato válido.');
    if (
      data.contractType === 'APPRENTICE' &&
      (!['TRADITIONAL', 'DUAL'].includes(data.apprenticeMode) ||
        !['LECTIVE', 'PRACTICAL'].includes(data.apprenticeStage))
    )
      throw new BadRequestException(
        'Completa la modalidad y etapa del aprendiz.',
      );
    if (
      data.contractType === 'APPRENTICE' &&
      (!validDate(data.stageStart) ||
        !validDate(data.stageEnd) ||
        data.stageStart > data.stageEnd)
    )
      throw new BadRequestException(
        'Completa las fechas de la etapa del aprendiz.',
      );
    if (
      data.bankName &&
      (!data.accountType?.trim() || !data.accountNumber?.trim())
    )
      throw new BadRequestException(
        'Completa el tipo y número de cuenta del empleado.',
      );
    try {
      cents(data.salary);
    } catch {
      throw new BadRequestException('Salario inválido.');
    }
    for (const field of [
      'documentTypeId',
      'typeWorkerId',
      'subTypeWorkerId',
      'paymentMethodId',
    ])
      if (!Number.isInteger(data[field]) || data[field] < 1)
        throw new BadRequestException(
          'Completa los códigos de trabajador y pago del catálogo de NextPyme.',
        );
    if (
      data.retirementDate &&
      (!validDate(data.retirementDate) ||
        data.retirementDate < data.admittanceDate)
    )
      throw new BadRequestException('Fecha de retiro inválida.');
    if (JSON.stringify(data).length > 20000)
      throw new BadRequestException('Registro demasiado grande.');
    const codes = await this.catalogs.getPayrollWorkerCatalogs(company);
    if (
      !codes.workerTypes.some((c) => c.id === data.typeWorkerId) ||
      !codes.workerSubtypes.some((c) => c.id === data.subTypeWorkerId)
    )
      throw new BadRequestException(
        'Selecciona tipos de trabajador válidos del catálogo de NextPyme.',
      );
    if (
      !codes.identifications.some((c) => c.id === data.documentTypeId) ||
      !codes.paymentMethods.some((c) => c.id === data.paymentMethodId)
    )
      throw new BadRequestException(
        'Selecciona un documento y método de pago válidos.',
      );
    return this.db
      .transaction(async (m) => {
        const [saved] = await m.query(
          `INSERT INTO jarvis_payroll_employees(id,company_id,identification,data,active) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET identification=EXCLUDED.identification,data=EXCLUDED.data,active=EXCLUDED.active,updated_at=now()
        WHERE jarvis_payroll_employees.company_id=EXCLUDED.company_id RETURNING id`,
          [
            id,
            company,
            data.identification,
            JSON.stringify(data),
            data.active !== false,
          ],
        );
        if (!saved) throw new NotFoundException();
        await this.audit(m, company, actor, 'EMPLOYEE_SAVED', id);
        return saved;
      })
      .catch((e) => {
        if (e.code === '23505')
          throw new ConflictException(
            'Ya existe un empleado con esa identificación.',
          );
        throw e;
      });
  }
  async savePosition(company: string, actor: string, id: string, data: any) {
    if (!data?.code?.trim() || !data?.name?.trim())
      throw new BadRequestException('Completa código y cargo.');
    try {
      cents(data.salary);
    } catch {
      throw new BadRequestException('Salario inválido.');
    }
    return this.db.transaction(async (m) => {
      const [saved] = await m.query(
        `INSERT INTO jarvis_payroll_positions(id,company_id,code,name,salary,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,salary=EXCLUDED.salary,active=EXCLUDED.active WHERE jarvis_payroll_positions.company_id=EXCLUDED.company_id RETURNING id`,
        [id, company, data.code, data.name, data.salary, data.active !== false],
      );
      if (!saved) throw new NotFoundException();
      await this.audit(m, company, actor, 'POSITION_SAVED', id);
      return saved;
    });
  }
  async saveParameters(company: string, actor: string, data: any) {
    if (!validDate(data?.validFrom))
      throw new BadRequestException('Fecha de vigencia inválida.');
    for (const field of ['monthlyDays', 'monthlyHours', 'weeklyHours'])
      if (!(Number(data[field]) > 0 && Number(data[field]) <= 744))
        throw new BadRequestException('Revisa las bases de cálculo.');
    for (const field of ['minimumSalary', 'transportAllowance']) {
      try {
        cents(data[field]);
      } catch {
        throw new BadRequestException('Revisa los valores legales.');
      }
    }
    if (!Array.isArray(data.concepts) || data.concepts.length > 100)
      throw new BadRequestException('Catálogo de conceptos inválido.');
    if (
      new Set(data.concepts.map((c: any) => c?.code)).size !==
      data.concepts.length
    )
      throw new BadRequestException(
        'Los códigos de conceptos deben ser únicos.',
      );
    for (const c of data.concepts) {
      if (!c.code || !c.name || !['accrued', 'deduction'].includes(c.kind))
        throw new BadRequestException('Completa los conceptos.');
      if (!['manual', 'salary', 'hourly'].includes(c.base))
        throw new BadRequestException('Base de cálculo inválida.');
      try {
        if (c.factor) cents(c.factor);
        if (c.percentage && cents(c.percentage) > 10000n) throw new Error();
      } catch {
        throw new BadRequestException('Revisa los factores y porcentajes.');
      }
      if (
        c.calculationMode === 'additional' &&
        c.factor &&
        cents(c.factor) < 100n
      )
        throw new BadRequestException(
          'Un factor total para recargo debe ser mayor o igual a uno.',
        );
      if (
        c.code.startsWith('internal_') &&
        !data.concepts.some(
          (base: any) =>
            base.code === c.category &&
            base.kind === c.kind &&
            !base.code.startsWith('internal_'),
        )
      )
        throw new BadRequestException(
          'Asocia cada concepto interno con una categoría válida.',
        );
    }
    const id = randomUUID();
    return this.db
      .transaction(async (m) => {
        await m.query(
          'INSERT INTO jarvis_payroll_parameters(id,company_id,valid_from,data) VALUES($1,$2,$3,$4)',
          [id, company, data.validFrom, JSON.stringify(data)],
        );
        await this.audit(m, company, actor, 'PARAMETERS_CREATED', id);
        return { id };
      })
      .catch((e) => {
        if (e.code === '23505')
          throw new ConflictException(
            'Ya existe una versión para esa fecha. Crea otra vigencia para conservar el historial.',
          );
        throw e;
      });
  }
  async saveSettings(company: string, actor: string, data: any) {
    if (
      ![1, 2].includes(data?.environment) ||
      !/^[A-Za-z0-9-]{1,20}$/.test(data?.prefix ?? '')
    )
      throw new BadRequestException('Ambiente o prefijo inválido.');
    return this.db.transaction(async (m) => {
      await m.query(
        `INSERT INTO jarvis_payroll_settings(company_id,settings) VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE SET settings=EXCLUDED.settings || jsonb_build_object('syncedEnvironment',jarvis_payroll_settings.settings->'syncedEnvironment'),updated_at=now()`,
        [
          company,
          JSON.stringify({
            environment: data.environment,
            prefix: data.prefix,
            enabled: data.enabled === true,
          }),
        ],
      );
      await this.audit(m, company, actor, 'SETTINGS_SAVED');
      return { saved: true };
    });
  }
  async configureEnvironment(company: string, actor: string) {
    const { settings } = await this.bootstrap(company);
    const token = await this.catalogs.requireCompanyToken(company);
    const result = await this.api.payrollRequest(
      'config/environment',
      { payroll_type_environment_id: settings.environment },
      token,
      'PUT',
    );
    if (!result || (result as any).success === false)
      throw new BadRequestException(
        'NextPyme no confirmó el ambiente de nómina.',
      );
    await this.db.query(
      `UPDATE jarvis_payroll_settings SET settings=settings || jsonb_build_object('syncedEnvironment',$2::int) WHERE company_id=$1 AND (settings->>'environment')::int=$2`,
      [company, settings.environment],
    );
    await this.audit(this.db.manager, company, actor, 'ENVIRONMENT_CONFIGURED');
    return result;
  }
  async list(company: string, period?: string) {
    return this.db.query(
      `SELECT id, employee_id AS "employeeId", original_id AS "originalId", state, employee_snapshot AS employee, status, number, prefix, cune, accrued, deductions, net, updated_at AS "updatedAt" FROM jarvis_payroll_documents WHERE company_id=$1 AND ($2::text IS NULL OR state->>'period'=$2) ORDER BY state->>'startDate' DESC,created_at DESC LIMIT 1000`,
      [company, period || null],
    );
  }
  async get(company: string, id: string) {
    const [document] = await this.db.query(
      'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2',
      [company, id],
    );
    if (!document) throw new NotFoundException('Nómina no encontrada.');
    const transmissions = await this.db.query(
      'SELECT id,request,response,validation,error,created_at FROM jarvis_payroll_transmissions WHERE company_id=$1 AND document_id=$2 ORDER BY created_at DESC',
      [company, id],
    );
    return {
      ...document,
      transmissions,
      files: transmissions.flatMap((t) => payrollFiles(t.response)),
    };
  }
  async createPeriod(
    company: string,
    actor: string,
    id: string,
    request: CreatePayrollPeriodRequest,
  ) {
    const errors = validatePayrollPeriod(request);
    if (errors.length) throw new BadRequestException(errors.join(' '));
    const name = request.name.trim();
    const { startDate, endDate } = payrollPeriodBounds(
      request.period,
      request.periodicity,
    );
    return this.db.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payroll:${company}`,
      ]);
      const existing = await m.query(
        `SELECT id,employee_id,state FROM jarvis_payroll_documents WHERE company_id=$1 AND state->>'payrollGroupId'=$2 AND original_id IS NULL ORDER BY employee_id`,
        [company, id],
      );
      if (existing.length) {
        const ids = existing.map((d: any) => d.employee_id).sort();
        if (
          JSON.stringify(ids) !==
            JSON.stringify([...request.employeeIds].sort()) ||
          existing.some(
            (d: any) =>
              d.state.payrollName !== name ||
              d.state.period !== request.period ||
              d.state.periodicity !== request.periodicity,
          )
        )
          throw new ConflictException(
            'Esta nómina ya se creó con otra información. Regresa al listado para consultarla.',
          );
        return {
          id,
          key: `${startDate}|${endDate}|${id}`,
          documentIds: existing.map((d: any) => d.id),
        };
      }
      const employees = await m.query(
        'SELECT id,data,active FROM jarvis_payroll_employees WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
        [company, request.employeeIds],
      );
      if (
        employees.length !== request.employeeIds.length ||
        employees.some((e: any) => !e.active)
      )
        throw new BadRequestException(
          'Selecciona únicamente empleados activos de esta empresa.',
        );
      const [parameter] = await m.query(
        'SELECT data FROM jarvis_payroll_parameters WHERE company_id=$1 AND valid_from <= $2 ORDER BY valid_from DESC LIMIT 1',
        [company, startDate],
      );
      if (!parameter)
        throw new BadRequestException(
          'Configura parámetros vigentes para el período seleccionado.',
        );
      if (
        !parameter.data.concepts?.some(
          (c: any) =>
            c.code === 'salary' && c.kind === 'accrued' && c.active !== false,
        )
      )
        throw new BadRequestException(
          'Activa el concepto de salario básico en los parámetros del período.',
        );
      const workedDays =
        request.periodicity === 'MONTHLY'
          ? String(parameter.data.monthlyDays)
          : prorate(String(parameter.data.monthlyDays), '1', '2');
      const issueDate = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Bogota',
      }).format(new Date());
      const documentIds: string[] = [];
      for (const employee of employees) {
        const documentId = randomUUID();
        const amount = prorate(
          String(employee.data.salary),
          workedDays,
          String(parameter.data.monthlyDays),
        );
        await this.saveDocument(
          company,
          actor,
          documentId,
          {
            payrollGroupId: id,
            payrollName: name,
            periodicity: request.periodicity,
            employeeId: employee.id,
            period: request.period,
            startDate,
            endDate,
            issueDate,
            workedDays,
            paymentDates: [endDate],
            lines: [
              {
                id: randomUUID(),
                concept: 'salary',
                kind: 'accrued',
                quantity: workedDays,
                amount,
                formula: `${employee.data.salary} / ${parameter.data.monthlyDays} días × ${workedDays} días`,
                manual: false,
              },
            ],
          },
          m,
        );
        documentIds.push(documentId);
      }
      await this.audit(m, company, actor, 'PAYROLL_PERIOD_CREATED', id);
      return { id, key: `${startDate}|${endDate}|${id}`, documentIds };
    });
  }
  async saveDocument(
    company: string,
    actor: string,
    id: string,
    state: any,
    manager?: EntityManager,
  ) {
    if (!state || JSON.stringify(state).length > 200000)
      throw new BadRequestException('Nómina inválida.');
    if (state.payrollGroupId) {
      const errors = validatePayrollPeriod({
        name: state.payrollName,
        period: state.period,
        periodicity: state.periodicity,
        employeeIds: [state.employeeId],
      });
      if (errors.length) throw new BadRequestException(errors.join(' '));
      const dates = payrollPeriodBounds(state.period, state.periodicity);
      if (
        state.startDate !== dates.startDate ||
        state.endDate !== dates.endDate
      )
        throw new BadRequestException(
          'Las fechas deben coincidir con la periodicidad de la nómina.',
        );
    }
    const save = async (m: EntityManager) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payroll:${company}`,
      ]);
      const [existing] = await m.query(
        'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE',
        [company, id],
      );
      if (existing && !['DRAFT', 'REJECTED'].includes(existing.status))
        throw new ConflictException('Esta nómina no admite cambios directos.');
      if (
        existing?.state.payrollGroupId &&
        (state.payrollGroupId !== existing.state.payrollGroupId ||
          state.payrollName !== existing.state.payrollName ||
          state.periodicity !== existing.state.periodicity)
      )
        throw new BadRequestException(
          'No se puede cambiar la información del período desde un documento individual.',
        );
      if (
        existing &&
        ((existing.original_id ?? null) !== (state.originalId ?? null) ||
          (existing.state.noteType ?? null) !== (state.noteType ?? null))
      )
        throw new BadRequestException(
          'No se puede cambiar la referencia de una nota existente.',
        );
      const [employee] = await m.query(
        'SELECT data,active FROM jarvis_payroll_employees WHERE company_id=$1 AND id=$2',
        [company, state.employeeId],
      );
      let worker =
        existing?.employee_id === state.employeeId
          ? existing.employee_snapshot
          : employee
            ? { ...employee.data, active: employee.active }
            : null;
      const errors = validatePayroll(state, worker);
      if (errors.length) throw new BadRequestException(errors.join(' '));
      const [parameter] = await m.query(
        'SELECT data FROM jarvis_payroll_parameters WHERE company_id=$1 AND valid_from <= $2 ORDER BY valid_from DESC LIMIT 1',
        [company, state.startDate],
      );
      if (!parameter)
        throw new BadRequestException(
          'Configura parámetros vigentes para el período.',
        );
      let original: any;
      if (state.originalId) {
        [original] = await m.query(
          'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2',
          [company, state.originalId],
        );
        if (
          !original ||
          original.status !== 'ACCEPTED' ||
          original.employee_id !== state.employeeId ||
          ![1, 2].includes(state.noteType)
        )
          throw new BadRequestException(
            'Selecciona una nómina aceptada para ajustar.',
          );
        worker = original.employee_snapshot;
      }
      const total = totals(state.lines);
      // Once edited, preserve parameters already captured for the document.
      const snapshot =
        existing?.parameter_snapshot ??
        original?.parameter_snapshot ??
        parameter.data;
      state.lines = state.lines.map((line: any) => {
        const concept = snapshot.concepts?.find(
          (c: any) => c.code === line.concept && c.kind === line.kind,
        );
        if (!concept)
          throw new BadRequestException(
            'El concepto no pertenece a los parámetros de esta nómina.',
          );
        return {
          ...line,
          mapping: concept.code.startsWith('internal_')
            ? concept.category
            : concept.code,
        };
      });
      const [saved] = await m.query(
        `INSERT INTO jarvis_payroll_documents(id,company_id,employee_id,original_id,state,employee_snapshot,parameter_snapshot,accrued,deductions,net) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,employee_id=EXCLUDED.employee_id,employee_snapshot=EXCLUDED.employee_snapshot,accrued=EXCLUDED.accrued,deductions=EXCLUDED.deductions,net=EXCLUDED.net,status='DRAFT',cune=NULL,updated_at=now() WHERE jarvis_payroll_documents.company_id=EXCLUDED.company_id RETURNING id`,
        [
          id,
          company,
          state.employeeId,
          state.originalId ?? null,
          JSON.stringify(state),
          JSON.stringify(worker),
          JSON.stringify(snapshot),
          total.accrued,
          total.deductions,
          total.net,
        ],
      );
      if (!saved) throw new NotFoundException();
      await this.audit(m, company, actor, 'PAYROLL_SAVED', id);
      return saved;
    };
    return (manager ? save(manager) : this.db.transaction(save)).catch((e) => {
      if (e.code === '23505')
        throw new ConflictException(
          'Ya existe una nómina de este empleado para esas fechas.',
        );
      throw e;
    });
  }
  async validate(company: string, id: string) {
    const d = await this.get(company, id);
    const { settings } = await this.bootstrap(company);
    const errors = validatePayroll(d.state, d.employee_snapshot, true);
    if (!settings.enabled)
      errors.push('Habilita la transmisión en configuración de nómina.');
    return { errors, valid: errors.length === 0 };
  }
  async send(company: string, actor: string, id: string) {
    const token = await this.catalogs.requireCompanyToken(company);
    const info = await this.api.payrollPlanInfo(token);
    const balance = collectRecords(info, { parseJsonStrings: true }).find(
      (r) => r.docs_left_absolut !== undefined,
    )?.docs_left_absolut;
    if (balance === undefined || !Number.isFinite(Number(balance)))
      throw new ServiceUnavailableException(
        'No se pudo verificar el cupo del paquete en NextPyme.',
      );
    if (Number(balance) <= 0)
      throw new BadRequestException(
        'No hay documentos disponibles en el paquete de NextPyme.',
      );
    const prepared = await this.plans.withJarvisQuotaLock(company, async () => {
      await this.plans.assertCanCreateDocuments({
        companyId: company,
        provider: IntegrationProvider.JARVIS,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        quantity: 1,
      });
      return this.db.transaction(async (m) => {
        await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `payroll:${company}`,
        ]);
        const [d] = await m.query(
          'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE',
          [company, id],
        );
        if (!d) throw new NotFoundException();
        if (!['DRAFT', 'REJECTED'].includes(d.status))
          throw new ConflictException(
            'La nómina ya se envió o tiene un envío pendiente de confirmación.',
          );
        const [s] = await m.query(
          'SELECT * FROM jarvis_payroll_settings WHERE company_id=$1 FOR UPDATE',
          [company],
        );
        if (!s?.settings.enabled)
          throw new BadRequestException('Habilita la transmisión de nómina.');
        if (s.settings.syncedEnvironment !== s.settings.environment)
          throw new BadRequestException(
            'Sincroniza el ambiente de nómina con NextPyme antes de enviar.',
          );
        const [currentEmployee] = await m.query(
          'SELECT active FROM jarvis_payroll_employees WHERE company_id=$1 AND id=$2',
          [company, d.employee_id],
        );
        if (!currentEmployee?.active)
          throw new BadRequestException('El empleado está inactivo.');
        const errors = validatePayroll(d.state, d.employee_snapshot, true);
        if (errors.length) throw new BadRequestException(errors.join(' '));
        const number = d.number ?? Number(s.next_number);
        if (!Number.isSafeInteger(Number(number)))
          throw new BadRequestException('Consecutivo fuera de rango.');
        let predecessor: any;
        if (d.original_id) {
          const [original] = await m.query(
            'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2',
            [company, d.original_id],
          );
          if (!original?.cune || original.status !== 'ACCEPTED')
            throw new BadRequestException(
              'El documento original no tiene CUNE aceptado.',
            );
          predecessor = {
            predecessor_number: `${original.prefix}${original.number}`,
            predecessor_cune: original.cune,
            predecessor_issue_date: original.state.issueDate,
          };
        }
        const payload = buildPayrollPayload(
          d.state,
          d.employee_snapshot,
          Number(number),
          d.prefix ?? s.settings.prefix,
          predecessor,
        );
        const transmission = randomUUID();
        await m.query(
          'INSERT INTO jarvis_payroll_transmissions(id,company_id,document_id,request) VALUES($1,$2,$3,$4)',
          [transmission, company, id, JSON.stringify(payload)],
        );
        await m.query(
          "UPDATE jarvis_payroll_documents SET status='PROCESSING',number=$3,prefix=$4,sent_at=now(),updated_at=now() WHERE company_id=$1 AND id=$2",
          [company, id, number, payload.prefix],
        );
        if (!d.number)
          await m.query(
            'UPDATE jarvis_payroll_settings SET next_number=next_number+1 WHERE company_id=$1',
            [company],
          );
        await this.audit(m, company, actor, 'PAYROLL_SEND_STARTED', id);
        return { payload, transmission, adjustment: !!d.original_id };
      });
    });
    let response: unknown;
    try {
      response = await this.api.payrollRequest(
        prepared.adjustment ? 'payroll-adjust-note' : 'payroll',
        prepared.payload,
        token,
      );
    } catch (error) {
      const providerError = axios.isAxiosError(error)
        ? error.response?.data
        : null;
      const safeError = providerError
        ? JSON.parse(
            JSON.stringify(providerError).split(token).join('[REDACTED]'),
          )
        : null;
      await this.db.transaction(async (m) => {
        await m.query(
          "UPDATE jarvis_payroll_documents SET status='UNCERTAIN',updated_at=now() WHERE company_id=$1 AND id=$2",
          [company, id],
        );
        await m.query(
          "UPDATE jarvis_payroll_transmissions SET response=$3,error='No se confirmó el resultado del proveedor; no reenviar automáticamente.',completed_at=now() WHERE company_id=$1 AND id=$2",
          [company, prepared.transmission, JSON.stringify(safeError)],
        );
      });
      throw new ServiceUnavailableException(
        'No se confirmó el envío. Se conservó la solicitud para verificar el resultado antes de reenviar.',
      );
    }
    const validation = parseDianValidationResult(response);
    const status =
      validation?.isValid === true
        ? 'ACCEPTED'
        : validation?.isValid === false
          ? 'REJECTED'
          : 'UNCERTAIN';
    await this.db.transaction(async (m) => {
      await m.query(
        'UPDATE jarvis_payroll_transmissions SET response=$3,validation=$4,completed_at=now() WHERE company_id=$1 AND id=$2',
        [
          company,
          prepared.transmission,
          JSON.stringify(response),
          JSON.stringify(validation),
        ],
      );
      await m.query(
        'UPDATE jarvis_payroll_documents SET status=$3,cune=$4,updated_at=now() WHERE company_id=$1 AND id=$2',
        [company, id, status, payrollCune(response)],
      );
      await this.audit(m, company, actor, `PAYROLL_${status}`, id);
    });
    return this.get(company, id);
  }

  async refreshStatus(company: string, actor: string, id: string) {
    const d = await this.get(company, id);
    if (!d.cune)
      throw new BadRequestException(
        'El proveedor no devolvió un CUNE. Se requiere confirmar el envío antes de reenviar.',
      );
    const token = await this.catalogs.requireCompanyToken(company);
    const response = await this.api.payrollStatus(d.cune, token);
    const validation = parseDianValidationResult(response);
    if (!validation || validation.isValid === null)
      throw new ServiceUnavailableException(
        'NextPyme aún no confirma la validación de la nómina.',
      );
    await this.db.transaction(async (m) => {
      const [current] = await m.query(
        'SELECT status FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE',
        [company, id],
      );
      if (current?.status === 'ACCEPTED' && !validation.isValid)
        throw new ConflictException(
          'No se puede revertir una aceptación mediante esta consulta.',
        );
      // A negative status lookup can mean "not found yet"; it does not prove rejection.
      const status = validation.isValid
        ? 'ACCEPTED'
        : current?.status === 'REJECTED'
          ? 'REJECTED'
          : 'UNCERTAIN';
      await m.query(
        'UPDATE jarvis_payroll_documents SET status=$3,updated_at=now() WHERE company_id=$1 AND id=$2',
        [company, id, status],
      );
      await m.query(
        'INSERT INTO jarvis_payroll_transmissions(id,company_id,document_id,request,response,validation,completed_at) VALUES($1,$2,$3,$4,$5,$6,now())',
        [
          randomUUID(),
          company,
          id,
          JSON.stringify({ operation: 'STATUS', cune: d.cune }),
          JSON.stringify(response),
          JSON.stringify(validation),
        ],
      );
      await this.audit(m, company, actor, `PAYROLL_STATUS_${status}`, id);
    });
    return this.get(company, id);
  }
  async download(company: string, id: string, kind: 'pdf' | 'xml') {
    const d = await this.get(company, id);
    const file = d.files.find((f) => f.kind === kind);
    if (!file)
      throw new NotFoundException(
        'El proveedor aún no tiene este archivo disponible.',
      );
    const [{ nit }] = await this.db.query(
      'SELECT nit FROM companies WHERE id=$1',
      [company],
    );
    const token = await this.catalogs.requireCompanyToken(company);
    const buffer = await this.api.payrollDownload(nit, file.filename, token);
    const head = buffer.subarray(0, 200).toString('utf8').trim();
    if (
      kind === 'pdf'
        ? !head.startsWith('%PDF-')
        : !head.startsWith('<?xml') && !head.startsWith('<')
    )
      throw new ServiceUnavailableException(
        'El proveedor no devolvió el archivo en un formato reconocido.',
      );
    return { buffer, filename: file.filename };
  }
}
