import { buildPayrollReplacementPayload, payrollReplacementTotals } from './payroll-replacement';
import { buildPayrollDeletionPayload, payrollAdjustmentState, payrollPredecessor, payrollAdjustmentProjection } from './payroll-adjustment';
import { duplicatePayrollNovelties } from './payroll-duplicate';
import { payrollPayloadRequiredErrors } from './payroll-payload-required';
import { payrollIssuerErrors } from './payroll-issuer';
import { payrollSubmissionWorker } from './payroll-submission-worker';
import { payrollDefaultLawDeductions, payrollRequiredDeductionErrors } from './payroll-required-deductions';
import { consolidatePayrollMonth, monthlyRevisions, assertMonthlyRevisions } from './payroll-monthly';
import { payrollLawOptionsForConcept } from './payroll-law-deduction-options';
import { dayOvertimeMaster, isDayOvertime } from './payroll-overtime';
import { ensurePayrollNumbering, PAYROLL_PREFIX, PAYROLL_NOTE_PREFIX, PAYROLL_RANGE_TO } from './payroll-numbering';
import { resolvePayrollContractId } from '../integration/jarvis/helpers/payroll-contract-types.helper';
import { employeePaymentType, employeeBankFields, employeeBankErrors } from './payroll-employee-payment';
import type { PayrollWorker } from './payroll-domain';
import { extendPayrollNoveltyConcepts, withPayrollAdditionalDeductions } from './payroll-novelty-concepts';
import { isPayrollEmployeeActive } from './payroll-employee-status';
import { payrollEmploymentDays, payrollWorkedTime } from './payroll-employment';
import { payrollPaymentColumns, payrollPaymentPresets, payrollPaymentMaster, type PayrollPaymentMethod } from './payroll-payment-methods';
import {
  HttpException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID, createHash } from 'crypto';
import axios from 'axios';
import { PlanSubscriptionService } from '../plan/plan-subscription.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { ElectronicDocumentType } from '../electronic-document/enums/electronic-document-type.enum';
import { NextPymeMasterCatalogService } from '../integration/jarvis/nextpyme/nextpyme-master-catalog.service';
import { NextPymeApiClient } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { payrollSubmissionErrors } from './payroll-submission-errors';
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

interface PayrollSendLogContext {
  company: string;
  document?: string;
  employee?: string;
  month?: string;
  stage: string;
  token?: string;
  httpStatus?: number;
  providerCode?: string;
  providerMessage?: string;
}

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  private logSubmissionError(error: unknown, context: PayrollSendLogContext) {
    const { token, ...details } = context;
    const provider = axios.isAxiosError(error) ? error : undefined;
    const authorization = provider?.config?.headers?.Authorization;
    const secrets = [token, typeof authorization === 'string' ? authorization.replace(/^Bearer\s+/i, '').trim() : undefined];
    const messages = payrollSubmissionErrors(error instanceof HttpException ? error.getResponse() : provider?.response?.data);
    let entry = JSON.stringify({
      ...details,
      httpStatus: provider?.response?.status ?? context.httpStatus ?? (error instanceof HttpException ? error.getStatus() : undefined),
      code: provider?.code ?? context.providerCode,
      message: messages.join(' | ') || provider?.message || (error instanceof Error ? error.message : 'Error inesperado al enviar la nómina.'),
    });
    for (const secret of secrets) if (secret) entry = entry.split(secret).join('[REDACTED]');
    this.logger.error(`[payroll] ERROR ${entry.replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]')}`);
  }

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
  async paymentMethods(company: string): Promise<{ items: PayrollPaymentMethod[]; total: number }> {
    if (!company?.trim()) throw new BadRequestException('La empresa activa es obligatoria.');
    const read = () => this.db.query<PayrollPaymentMethod[]>(
      `SELECT ${payrollPaymentColumns} FROM jarvis_payroll_payment_methods WHERE company_id=$1 ORDER BY CASE system_key WHEN 'cash' THEN 0 WHEN 'transfer' THEN 1 ELSE 2 END, lower(name), id`,
      [company],
    );
    let items = await read();
    const missing = payrollPaymentPresets.filter(preset => !items.some(item => item.systemKey === preset.systemKey));
    if (missing.length) {
      const catalog = await this.catalogs.getPaymentMethods(company);
      // Resolve both before writing; a catalog failure must not invent provider IDs.
      const defaults = missing.map(preset => ({ preset, master: payrollPaymentMaster(catalog, preset) }));
      for (const { preset, master } of defaults) {
        await this.db.query(
          `INSERT INTO jarvis_payroll_payment_methods(id,company_id,name,system_key,nextpyme_method_id,nextpyme_method_name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [randomUUID(), company, preset.name, preset.systemKey, master.id, master.name],
        );
      }
      items = await read();
    }
    items = items.map(item => item.systemKey === 'transfer' ? { ...item, name: 'Consignación bancaria' } : item);
    return { items, total: items.length };
  }

  async createPaymentMethod(company: string, actor: string, request: { name?: unknown; base?: unknown }) {
    const name = typeof request?.name === 'string' ? request.name.trim() : '';
    if (!name || name.length > 120) throw new BadRequestException('El nombre debe tener entre 1 y 120 caracteres.');
    if (request?.base !== 'cash' && request?.base !== 'transfer') throw new BadRequestException('Selecciona Efectivo o Transferencia bancaria.');
    const { items } = await this.paymentMethods(company);
    if (items.some(item => item.name.trim().toLowerCase() === name.toLowerCase())) throw new ConflictException('Ya existe una forma de pago con ese nombre.');
    const base = items.find(item => item.systemKey === request.base);
    if (!base) throw new ServiceUnavailableException('El medio de pago no está disponible.');
    try {
      return await this.db.transaction(async manager => {
        const [paymentMethod] = await manager.query<PayrollPaymentMethod[]>(
          `INSERT INTO jarvis_payroll_payment_methods(id,company_id,name,system_key,nextpyme_method_id,nextpyme_method_name) VALUES($1,$2,$3,NULL,$4,$5) RETURNING ${payrollPaymentColumns}`,
          [randomUUID(), company, name, base.nextpymeMethodId, base.nextpymeMethodName],
        );
        await this.audit(manager, company, actor, 'PAYMENT_METHOD_CREATED', paymentMethod.id);
        return { paymentMethod };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Ya existe una forma de pago con ese nombre.');
      throw error;
    }
  }


  workerCatalogs(company: string) {
    return this.catalogs.getPayrollWorkerCatalogs(company);
  }
  overtimeSurcharges(company: string) {
    return this.catalogs.getPayrollOvertimeSurcharges(company);
  }
  disabilityTypes(company: string) {
    return this.catalogs.getPayrollDisabilityTypes(company);
  }
  lawDeductions(company: string) {
    return this.catalogs.getPayrollLawDeductions(company);
  }
  private async validateLawDeductionMaster(company: string, state: import('./payroll-domain').PayrollInput) {
    const keys = ['eps', 'pension', 'solidarity', 'subsistence'];
    const lines = state.lines.filter(line => keys.includes(line.mapping ?? line.concept));
    if (!lines.length) return;
    const rows = await this.catalogs.getPayrollLawDeductions(company);
    for (const line of lines) {
      const key = line.mapping ?? line.concept;
      const id = line.typeLawDeductionsId ?? (key === 'eps' ? state.epsTypeLawDeductionsId : key === 'pension' ? state.pensionTypeLawDeductionsId : undefined);
      if (!payrollLawOptionsForConcept(rows, key).some(row => row.id === id))
        throw new BadRequestException('Selecciona un tipo de deducción de ley del catálogo de NextPyme. Abre la novedad y vuelve a guardarla.');
    }
  }
  private async validateDisabilityMaster(company: string, state: { lines: import('./payroll-domain').PayrollLine[] }) {
    const lines = state.lines.filter(line => (line.mapping ?? line.concept) === 'disability');
    if (!lines.length) return;
    const rows = await this.catalogs.getPayrollDisabilityTypes(company);
    if (lines.some(line => !rows.some(row => row.id === line.type)))
      throw new BadRequestException('Selecciona un tipo de incapacidad de la tabla maestra de NextPyme. Abre la novedad y vuelve a guardarla.');
  }
  private async validateDayOvertimeMaster(company: string, state: { lines: import('./payroll-domain').PayrollLine[] }) {
    if (!state.lines.some(line => ['overtime_day', 'overtime_night'].includes(line.mapping ?? line.concept))) return;
    const rows = await this.catalogs.getPayrollOvertimeSurcharges(company);
    for (const code of ['overtime_day', 'overtime_night'] as const) {
      const lines = state.lines.filter((line) => (line.mapping ?? line.concept) === code);
      if (!lines.length) continue;
      const master = dayOvertimeMaster(rows, code);
      if (!master || lines.some(line => line.overtimeSurchargeId !== master.id))
        throw new BadRequestException(
          code === 'overtime_day'
            ? 'Revisa el recargo de las horas extra diurnas. Abre la novedad y vuelve a guardarla.'
            : 'Revisa el recargo de las horas extra nocturnas. Abre la novedad y vuelve a guardarla.',
        );
    }
  }
  async bootstrap(company: string) {
    await ensurePayrollNumbering(this.db, company);
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
        active: isPayrollEmployeeActive(e.data.retirementDate),
      })),
      positions,
      parameters: parameters.map(row => ({ ...row, data: withPayrollAdditionalDeductions(row.data) })),
      settings: settings[0]?.settings ?? {
        environment: 2,
        prefix: PAYROLL_PREFIX,
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
    const typeContractId = resolvePayrollContractId(data.contractType as string, codes.contractTypes, data.typeContractId as number | undefined);
    const paymentMethodType = employeePaymentType(data.paymentMethodId as number, codes.paymentMethods);
    const paymentWorker = { ...data, paymentMethodType } as PayrollWorker;
    const bankErrors = employeeBankErrors(paymentWorker);
    if (bankErrors.length) throw new BadRequestException(bankErrors.join(' '));
    const bankFields = paymentMethodType ? employeeBankFields(paymentWorker, paymentMethodType) : {};
    return this.db
      .transaction(async (m) => {
        const [saved] = await m.query(
          `INSERT INTO jarvis_payroll_employees(id,company_id,identification,data,active) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET identification=EXCLUDED.identification,data=EXCLUDED.data,active=EXCLUDED.active,updated_at=now()
        WHERE jarvis_payroll_employees.company_id=EXCLUDED.company_id RETURNING id, worker_code AS "workerCode"`,
          [
            id,
            company,
            data.identification,
            JSON.stringify({ ...data, ...bankFields, paymentMethodType, typeContractId, highRiskPension: false, active: isPayrollEmployeeActive(data.retirementDate) }),
            isPayrollEmployeeActive(data.retirementDate),
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
  async deletePosition(company: string, actor: string, id: string) {
    return this.db.transaction(async (manager) => {
      // Preserve the name and ID for employees and historical payroll records.
      const [position] = await manager.query(
        'UPDATE jarvis_payroll_positions SET active=false WHERE company_id=$1 AND id=$2 RETURNING id',
        [company, id],
      );
      if (!position) throw new NotFoundException('El cargo no existe.');
      await this.audit(manager, company, actor, 'POSITION_DELETED', id);
      return { deleted: true };
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
        const [saved] = await m.query(
          `INSERT INTO jarvis_payroll_parameters(id,company_id,valid_from,data) VALUES($1,$2,$3,$4) RETURNING id`,
          [id, company, data.validFrom, JSON.stringify(data)],
        );
        await this.audit(m, company, actor, 'PARAMETERS_CREATED', saved.id);
        return { id: saved.id };
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
    if (![1, 2].includes(data?.environment))
      throw new BadRequestException('Ambiente inválido.');
    return this.db.transaction(async (m) => {
      await ensurePayrollNumbering(m, company);
      await m.query(
        `INSERT INTO jarvis_payroll_settings(company_id,settings) VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()`,
        [
          company,
          JSON.stringify({
            environment: data.environment,
            prefix: PAYROLL_PREFIX,
            enabled: data.enabled === true,
          }),
        ],
      );
      await this.audit(m, company, actor, 'SETTINGS_SAVED');
      return { saved: true };
    });
  }
  async list(company: string, period?: string) {
    const rows = await this.db.query(
      `SELECT id, md5((state - 'monthlyDocumentId' - 'monthlyConsolidation')::text || employee_snapshot::text || parameter_snapshot::text) AS "sourceVersion", employee_id AS "employeeId", original_id AS "originalId", state, employee_snapshot AS employee, status, number, prefix, cune, accrued, deductions, net, updated_at AS "updatedAt", (SELECT jsonb_build_object('error',t.error,'validation',t.validation,'response',t.response) FROM jarvis_payroll_transmissions t WHERE t.company_id=$1 AND t.document_id=jarvis_payroll_documents.id AND jarvis_payroll_documents.status IN ('REJECTED','UNCERTAIN') ORDER BY t.created_at DESC LIMIT 1) AS "lastResult", (status='DRAFT' AND sent_at IS NULL AND number IS NULL AND cune IS NULL AND NOT EXISTS (SELECT 1 FROM jarvis_payroll_transmissions t WHERE t.company_id=$1 AND t.document_id=jarvis_payroll_documents.id)) AS "canDelete" FROM jarvis_payroll_documents WHERE company_id=$1 AND (state #>> '{monthlyConsolidation,generated}') IS DISTINCT FROM 'true' AND ($2::text IS NULL OR state->>'period'=$2) ORDER BY state->>'startDate' DESC,created_at DESC LIMIT 1000`,
      [company, period || null],
    );
    const monthlyIds = [...new Set(rows.flatMap((row: any) => row.state?.monthlyDocumentId ? [row.state?.monthlyDocumentId] : row.state?.monthlyConsolidation ? [row.id] : []))];
    const monthlyRows = monthlyIds.length ? await this.db.query(
      `SELECT d.id,d.status,d.cune,d.number,d.prefix,(SELECT jsonb_build_object('error',t.error,'validation',t.validation,'response',t.response) FROM jarvis_payroll_transmissions t WHERE t.company_id=$1 AND t.document_id=d.id ORDER BY t.created_at DESC LIMIT 1) AS "lastResult" FROM jarvis_payroll_documents d WHERE d.company_id=$1 AND d.id=ANY($2::uuid[])`, [company, monthlyIds]) : [];
    const monthlyById = new Map<string, any>(monthlyRows.map((row: any) => [row.id, row]));
    const adjustmentPeriods = [...new Set(rows.flatMap((row: any) => row.state?.period ? [row.state.period] : []))];
    const adjustmentNotes = adjustmentPeriods.length ? await this.db.query(
      "SELECT id,original_id,status,state,number,prefix FROM jarvis_payroll_documents WHERE company_id=$1 AND original_id IS NOT NULL AND state->>'period'=ANY($2::text[]) ORDER BY created_at DESC", [company, adjustmentPeriods]) : [];
    return rows.map(({ lastResult, ...row }) => {
      const monthly = !row.originalId ? monthlyById.get(row.state?.monthlyDocumentId ?? (row.state?.monthlyConsolidation ? row.id : '')) : undefined;
      const sourceStatus = row.status;
      if (monthly) { row.status = monthly.status; row.canDelete = false; lastResult = monthly.lastResult; }
      const failed = ['REJECTED', 'UNCERTAIN'].includes(row.status);
      const messages = failed ? payrollSubmissionErrors(lastResult) : [];
      return { ...row, ...(!row.originalId ? payrollAdjustmentProjection(monthly?.id ?? row.id, adjustmentNotes) : {}), sourceStatus, monthlySubmission: monthly ? { id: monthly.id, status: monthly.status, cune: monthly.cune, number: monthly.number, prefix: monthly.prefix } : undefined, submissionErrors: !failed ? [] : messages.length ? messages : [row.status === 'UNCERTAIN'
        ? 'No se confirmó el envío. Verifica el resultado antes de reenviar.'
        : 'El envío no fue aceptado. Revisa los datos de la nómina.'] };
    });
  }

  async deleteDocument(company: string, actor: string, id: string) {
    return this.db.transaction(async (manager) => {
      // Serialize with send/save so deletion cannot race an outgoing document.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payroll:${company}`,
      ]);
      const [document] = await manager.query(
        'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE',
        [company, id],
      );
      if (!document) throw new NotFoundException('La nómina no existe.');
      if (document.state?.monthlyDocumentId || document.state?.monthlyConsolidation) throw new ConflictException('El período ya pertenece a un consolidado mensual y conserva su historial.');
      if (document.status !== 'DRAFT' || document.sent_at || document.number != null || document.cune) {
        throw new ConflictException('Solo puedes eliminar borradores que nunca se hayan enviado.');
      }
      const [transmission] = await manager.query(
        'SELECT id FROM jarvis_payroll_transmissions WHERE company_id=$1 AND document_id=$2 LIMIT 1',
        [company, id],
      );
      if (transmission) throw new ConflictException('Esta nómina tiene historial de envío y no se puede eliminar.');
      await manager.query('DELETE FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2', [company, id]);
      await this.audit(manager, company, actor, 'DOCUMENT_DELETED', id);
      return { deleted: true };
    });
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
    const duplicateSources = [...(request.duplicateSources ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    const duplicationSourceKey = duplicateSources.length ? createHash('sha256').update(JSON.stringify(duplicateSources)).digest('hex') : null;
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
              (d.state.duplicationSourceKey ?? null) !== duplicationSourceKey ||
              d.state.payrollName !== name ||
              d.state.period !== request.period ||
              d.state.periodicity !== request.periodicity ||
              d.state.paymentDates?.[0] !== request.paymentDate,
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
      const sources = duplicateSources.length ? await m.query(
        'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',
        [company, duplicateSources.map(source => source.id)],
      ) : [];
      if (sources.length !== duplicateSources.length) throw new NotFoundException('La nómina de origen no existe o no pertenece a esta empresa.');
      const sourcePeriod = (source: any) => JSON.stringify([source.state.startDate, source.state.endDate, source.state.payrollGroupId ?? '']);
      if (sources.some((source: any) => source.original_id || source.state.monthlyConsolidation?.generated || sourcePeriod(source) !== sourcePeriod(sources[0])) || new Set(sources.map((source: any) => source.employee_id)).size !== sources.length)
        throw new BadRequestException('Selecciona un único período de nómina de origen con un documento por empleado.');
      for (const source of sources) {
        const revision = duplicateSources.find(item => item.id === source.id)!;
        if (new Date(source.updated_at).getTime() !== new Date(revision.updatedAt).getTime())
          throw new ConflictException('La nómina de origen cambió. Vuelve al listado y selecciona Duplicar nuevamente.');
      }
      const employees = await m.query(
        'SELECT id,data,active FROM jarvis_payroll_employees WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
        [company, request.employeeIds],
      );
      if (
        employees.length !== request.employeeIds.length ||
        employees.some((e: any) => !isPayrollEmployeeActive(e.data.retirementDate))
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
      const periodWorkedDays =
        request.periodicity === 'MONTHLY'
          ? String(parameter.data.monthlyDays)
          : prorate(String(parameter.data.monthlyDays), '1', '2');
      const issueDate = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Bogota',
      }).format(new Date());
      const documentIds: string[] = [];
      for (const employee of employees) {
        const employment = payrollEmploymentDays({ startDate, endDate }, employee.data);
        if (employment.days <= 0) throw new BadRequestException('El empleado no tiene días de vinculación en este período.');
        const workedDays = employment.days === employment.periodDays
          ? periodWorkedDays
          : prorate(periodWorkedDays, String(employment.days), String(employment.periodDays));
        const documentId = randomUUID();
        const source = sources.find((source: any) => source.employee_id === employee.id);
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
            paymentDates: [request.paymentDate],
            ...(source ? duplicatePayrollNovelties(source.state, { startDate, endDate }) : { workedDays, lines: [] }),
            ...(source ? { duplicatedFromDocumentId: source.id, duplicationSourceKey } : duplicationSourceKey ? { duplicationSourceKey } : {}),
          },
          m,
          source ? { sourceConcepts: source.parameter_snapshot?.concepts ?? [] } : undefined,
        );
        documentIds.push(documentId);
      }
      await this.audit(m, company, actor, 'PAYROLL_PERIOD_CREATED', id);
      return { id, key: `${startDate}|${endDate}|${id}`, documentIds };
    });
  }
  async prepareAdjustment(company: string, actor: string, originalId: string, id: string, request: any) {
    if (!request || ![1, 2].includes(request.noteType) || !request.state || !validDate(request.state.issueDate) ||
      !Array.isArray(request.state.lines) || request.state.lines.length > 1000 || request.state.lines.some((line: any) => !line || typeof line !== 'object') ||
      JSON.stringify(request.state).length > 200000)
      throw new BadRequestException('Revisa el tipo y la fecha del ajuste.');
    await this.db.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payroll:${company}`]);
      const [original] = await m.query('SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE', [company, originalId]);
      if (!original) throw new NotFoundException('Nómina no encontrada.');
      payrollPredecessor(original);
      const hash = createHash('sha256').update(JSON.stringify({ originalId, noteType: request.noteType, state: request.state })).digest('hex');
      const [existing] = await m.query('SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE', [company, id]);
      if (existing) {
        if (existing.original_id !== originalId || existing.state.noteType !== request.noteType)
          throw new ConflictException('El ajuste no corresponde a este documento.');
        if (existing.state.adjustmentRequestKey === hash) return;
        if (!['DRAFT', 'REJECTED'].includes(existing.status)) throw new ConflictException('Este ajuste ya se envió o está pendiente de confirmación.');
        if (!request.updatedAt || new Date(request.updatedAt).getTime() !== new Date(existing.updated_at).getTime())
          throw new ConflictException('El ajuste cambió. Vuelve a abrirlo antes de guardar.');
      } else if (!request.originalUpdatedAt || new Date(request.originalUpdatedAt).getTime() !== new Date(original.updated_at).getTime()) {
        throw new ConflictException('El documento cambió. Vuelve a consultarlo antes de ajustar.');
      }
      const children = await m.query('SELECT id,status FROM jarvis_payroll_documents WHERE company_id=$1 AND original_id=$2 FOR UPDATE', [company, originalId]);
      if (children.some((note: any) => note.id !== id))
        throw new ConflictException('Este documento ya tiene un ajuste. Vuelve al listado para consultar o continuar el ajuste existente.');
      const state = payrollAdjustmentState(original, request.noteType, request.state);
      state.adjustmentRequestKey = hash;
      state.payrollPeriodId ??= await this.catalogs.getPayrollPeriodId(company, state.periodicity === 'MONTHLY' ? 'Mensual' : 'Quincenal');
      if (existing) {
        // Conservar identificadores de línea en un borrador existente para que los
        // reintentos no generen cambios artificiales en los conceptos.
        state.lines = request.noteType === 1 ? request.state.lines : existing.state.lines;
      }
      await this.saveDocument(company, actor, id, state, m, { validation: 'provider' });
    });
    return this.get(company, id);
  }


  async saveDocuments(company: string, actor: string, request: unknown) {
    const documents = (request as { documents?: unknown } | null)?.documents;
    if (!Array.isArray(documents) || !documents.length || documents.length > 1000 || JSON.stringify(documents).length > 10000000)
      throw new BadRequestException('Selecciona entre 1 y 1000 documentos para guardar.');
    const ids = new Set<string>();
    for (const item of documents) {
      if (!item || typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) || ids.has(item.id) ||
        !item.state || typeof item.state !== 'object' || Array.isArray(item.state) ||
        typeof item.updatedAt !== 'string' || !item.updatedAt.trim() || !Number.isFinite(Date.parse(item.updatedAt)))
        throw new BadRequestException('Los documentos y su versión de edición no son válidos.');
      ids.add(item.id);
    }
    return this.db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'payroll:' + company,
      ]);
      // Validate every revision before writing; a failed document rolls back the whole batch.
      const rows = await manager.query(
        'SELECT id,updated_at,status FROM jarvis_payroll_documents WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
        [company, [...ids]],
      );
      for (const item of documents) {
        const current = rows.find((row: { id: string }) => row.id === item.id);
        if (!current) throw new NotFoundException('Un documento ya no existe o no pertenece a esta empresa.');
        if (!['DRAFT', 'REJECTED'].includes(current.status))
          throw new ConflictException('Una nómina ya se envió o está pendiente de confirmación. No se guardó ningún cambio.');
        if (new Date(current.updated_at).getTime() !== new Date(item.updatedAt).getTime())
          throw new ConflictException('La nómina cambió desde que la abriste. No se guardó ningún cambio; tus novedades locales se conservan.');
      }
      for (const item of documents) await this.saveDocument(company, actor, item.id, item.state, manager);
      return { saved: [...ids] };
    });
  }
  async saveDocument(
    company: string,
    actor: string,
    id: string,
    state: any,
    manager?: EntityManager,
    options: { validation?: 'local' | 'provider'; sourceConcepts?: Array<{ code: string; kind: string; [key: string]: unknown }> } = {},
  ) {
    const validate = options.validation !== 'provider';
    if (!state || JSON.stringify(state).length > 200000)
      throw new BadRequestException('Nómina inválida.');
    if (state.payrollGroupId) {
      const errors = validatePayrollPeriod({
        name: state.payrollName,
        period: state.period,
        periodicity: state.periodicity,
        employeeIds: [state.employeeId],
        paymentDate: state.paymentDates?.[0],
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
    state = { ...state };
    delete state.monthlyDocumentId;
    delete state.monthlyConsolidation;
    const save = async (m: EntityManager) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payroll:${company}`,
      ]);
      const [existing] = await m.query(
        'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE',
        [company, id],
      );
      if (existing?.state.monthlyConsolidation?.generated) throw new ConflictException('Corrige las quincenas de origen y vuelve a enviar desde el resumen mensual.');
      if (!state.originalId) {
        await this.assertMonthlyEditable(m, company, state.employeeId, state.period);
        if (existing?.employee_id && (existing.employee_id !== state.employeeId || existing.state.period !== state.period)) await this.assertMonthlyEditable(m, company, existing.employee_id, existing.state.period);
        if ((existing?.state.monthlyDocumentId || existing?.state.monthlyConsolidation) && (existing.employee_id !== state.employeeId || existing.state.period !== state.period)) throw new ConflictException('No se puede mover a otro empleado o mes un período que ya pertenece a una consolidación.');
        if (existing?.state.monthlyDocumentId) state.monthlyDocumentId = existing.state.monthlyDocumentId;
        if (existing?.state.monthlyConsolidation) state.monthlyConsolidation = existing.state.monthlyConsolidation;
      }
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
            ? { ...employee.data, active: isPayrollEmployeeActive(employee.data.retirementDate) }
            : null;
      if (!worker) throw new NotFoundException('El empleado no pertenece a esta empresa.');
      const errors = validate ? validatePayroll(state, worker) : [];
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
        payrollPredecessor(original);
        if (state.period !== original.state.period || state.startDate !== original.state.startDate || state.endDate !== original.state.endDate)
          throw new BadRequestException('El ajuste debe conservar el período del documento aceptado.');
        const related = await m.query('SELECT id,status FROM jarvis_payroll_documents WHERE company_id=$1 AND original_id=$2 FOR UPDATE', [company, original.id]);
        if (related.some((note: any) => note.id !== id)) throw new ConflictException('Este documento ya tiene otro ajuste.');
        worker = original.employee_snapshot;
      }
      // Conserva los datos históricos del documento y toma solo el código persistido del empleado.
      if (worker && employee?.data.workerCode) worker = { ...worker, workerCode: employee.data.workerCode };
      try { state.workedTime = String(payrollWorkedTime(state.endDate, worker)); }
      catch (error) { if (validate) throw error; }
      const total = state.originalId && state.noteType === 1 ? payrollReplacementTotals(state.lines) : totals(state.lines);
      // Once edited, preserve parameters already captured for the document.
      let snapshot =
        existing?.parameter_snapshot ??
        original?.parameter_snapshot ??
        parameter.data;
      if (!existing && options.sourceConcepts?.length) {
        snapshot = { ...snapshot, concepts: [...(snapshot.concepts ?? []), ...options.sourceConcepts.filter(concept => !snapshot.concepts?.some((current: any) => current.code === concept.code && current.kind === concept.kind))] };
      }
      // Los conceptos nuevos configurados se incorporan al borrador sin cambiar sus bases históricas.
      if ((!state.originalId || state.noteType === 1) && state.lines.some((line: any) => !snapshot.concepts?.some((concept: any) => concept.code === line.concept && concept.kind === line.kind))) {
        const [configured] = await m.query(
          "SELECT data FROM jarvis_payroll_parameters WHERE company_id=$1 AND valid_from <= (now() AT TIME ZONE 'America/Bogota')::date ORDER BY valid_from DESC LIMIT 1",
          [company],
        );
        try { snapshot = extendPayrollNoveltyConcepts(snapshot, configured?.data, state.lines); }
        catch (error) { if (validate) throw error; }
      }
      state.lines = state.lines.map((line: any) => {
        const concept = snapshot.concepts?.find(
          (c: any) => c.code === line.concept && c.kind === line.kind,
        );
        if (!concept && !validate) return line;
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
      if (validate) {
        await this.validateLawDeductionMaster(company, state);
        await this.validateDisabilityMaster(company, state);
        await this.validateDayOvertimeMaster(company, state);
      }
      const [saved] = await m.query(
        `INSERT INTO jarvis_payroll_documents(id,company_id,employee_id,original_id,state,employee_snapshot,parameter_snapshot,accrued,deductions,net) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,employee_id=EXCLUDED.employee_id,employee_snapshot=EXCLUDED.employee_snapshot,parameter_snapshot=EXCLUDED.parameter_snapshot,accrued=EXCLUDED.accrued,deductions=EXCLUDED.deductions,net=EXCLUDED.net,status='DRAFT',cune=NULL,updated_at=now() WHERE jarvis_payroll_documents.company_id=EXCLUDED.company_id RETURNING id`,
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
  private async resolveSubmissionWorker(company: string, snapshot: PayrollWorker, current: Partial<PayrollWorker> & { contractType?: string }): Promise<PayrollWorker> {
    const worker = payrollSubmissionWorker(snapshot, current);
    const { paymentMethods, contractTypes } = await this.catalogs.getPayrollWorkerCatalogs(company);
    if (!paymentMethods?.some(method => method.id === worker.paymentMethodId))
      throw new BadRequestException('Selecciona un método de pago vigente en el empleado.');
    const paymentMethodType = employeePaymentType(worker.paymentMethodId, paymentMethods);
    const resolved = { ...worker, paymentMethodType,
      ...(worker.contractType ? { typeContractId: resolvePayrollContractId(worker.contractType, contractTypes) } : {}),
      ...(paymentMethodType === 'cash' ? employeeBankFields(worker, 'cash') : {}),
    };
    return resolved;
  }
  async validate(company: string, id: string) {
    const d = await this.get(company, id);
    d.state = payrollDefaultLawDeductions(d.state);
    const { employees } = await this.bootstrap(company);
    const currentEmployee = employees.find((employee: { id: string }) => employee.id === d.employee_id);
    const paymentWorker = await this.resolveSubmissionWorker(company, d.employee_snapshot as PayrollWorker, currentEmployee ?? {});
    const errors = [...validatePayroll(d.state, { ...paymentWorker, active: isPayrollEmployeeActive(d.employee_snapshot.retirementDate) }, true), ...payrollRequiredDeductionErrors(d.state)];
    return { errors, valid: errors.length === 0 };
  }
  private async assertMonthlyEditable(m: EntityManager, company: string, employee: string, month: string) {
    const [monthly] = await m.query(
      "SELECT id,status FROM jarvis_payroll_documents WHERE company_id=$1 AND employee_id=$2 AND state->>'period'=$3 AND state ? 'monthlyConsolidation' FOR UPDATE",
      [company, employee, month],
    );
    if (monthly && ['ACCEPTED', 'PROCESSING', 'UNCERTAIN'].includes(monthly.status))
      throw new ConflictException('Este mes ya se envió o está pendiente de confirmación para el empleado. Revisa el resultado mensual; las correcciones de un documento aceptado requieren una nota de ajuste.');
  }

  async sendDocument(company: string, actor: string, id: string) {
    try {
      const document = await this.get(company, id);
      if (!document.original_id && !document.state.monthlyConsolidation)
        throw new BadRequestException('Envía la nómina desde el resumen mensual para consolidar todos los períodos del empleado.');
    } catch (error) {
      this.logSubmissionError(error, { company, document: id, stage: 'VALIDATE_DOCUMENT' });
      throw error;
    }
    return this.send(company, actor, id);
  }

  async sendMonthlyEmployee(company: string, actor: string, month: string, employee: string, expected: unknown) {
    const context = { company, employee, month, stage: 'CONSOLIDATE_MONTH' };
    this.logger.log(`[payroll] PREPARE_MONTH ${JSON.stringify(context)}`);
    let prepared: Awaited<ReturnType<PayrollService['get']>>;
    try {
      prepared = await this.prepareMonthlyEmployee(company, actor, month, employee, expected);
    } catch (error) {
      this.logSubmissionError(error, context);
      throw error;
    }
    if (['ACCEPTED', 'PROCESSING', 'UNCERTAIN'].includes(prepared.status)) return prepared;
    return this.send(company, actor, prepared.id);
  }

  private async prepareMonthlyEmployee(company: string, actor: string, month: string, employee: string, expected: unknown) {
    try { payrollPeriodBounds(month, 'MONTHLY'); } catch { throw new BadRequestException('Selecciona un mes válido.'); }
    const loaded = await this.db.query(
      "SELECT *, md5((state - 'monthlyDocumentId' - 'monthlyConsolidation')::text || employee_snapshot::text || parameter_snapshot::text) AS \"sourceVersion\" FROM jarvis_payroll_documents WHERE company_id=$1 AND employee_id=$2 AND original_id IS NULL AND state->>'period'=$3 AND (state #>> '{monthlyConsolidation,generated}') IS DISTINCT FROM 'true' ORDER BY id",
      [company, employee, month],
    );
    if (!loaded.length) throw new NotFoundException('No hay períodos de este empleado en el mes seleccionado.');
    // payroll_period_id describes payment frequency; reporting still covers the complete month.
    const frequency = loaded.every((row: any) => row.state.periodicity === 'MONTHLY' ||
      (row.state.startDate.endsWith('-01') && Number(row.state.endDate.slice(-2)) >= 28)) ? 'Mensual' : 'Quincenal';
    const periodId = await this.catalogs.getPayrollPeriodId(company, frequency);
    const id = await this.db.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payroll:${company}`]);
      const rows = await m.query(
        "SELECT *, md5((state - 'monthlyDocumentId' - 'monthlyConsolidation')::text || employee_snapshot::text || parameter_snapshot::text) AS \"sourceVersion\" FROM jarvis_payroll_documents WHERE company_id=$1 AND employee_id=$2 AND original_id IS NULL AND state->>'period'=$3 ORDER BY id FOR UPDATE",
        [company, employee, month],
      );
      const existing = rows.find((row: any) => row.state.monthlyConsolidation);
      // Idempotent: an accepted/in-flight monthly document is never transmitted twice.
      if (existing && ['ACCEPTED', 'PROCESSING', 'UNCERTAIN'].includes(existing.status)) return existing.id;
      const sources = rows.filter((row: any) => !row.state.monthlyConsolidation?.generated);
      try { assertMonthlyRevisions(sources, expected); } catch (error) { throw new ConflictException((error as Error).message); }
      if (sources.some((row: any) => !row.state.monthlyConsolidation &&
        (!['DRAFT', 'REJECTED'].includes(row.status) || row.sent_at || row.number != null || row.cune)))
        throw new ConflictException('Hay períodos enviados individualmente en este mes. Verifica esos envíos antes de consolidar para evitar duplicados.');
      const [current] = await m.query('SELECT data,active FROM jarvis_payroll_employees WHERE company_id=$1 AND id=$2', [company, employee]);
      if (!current) throw new NotFoundException('El empleado no pertenece a esta empresa.');
      const enriched = sources.map((row: any) => ({ ...row, employee_snapshot: { ...payrollSubmissionWorker(row.employee_snapshot, current.data),
        retirementDate: current.data.retirementDate || row.employee_snapshot.retirementDate,
      } }));
      let consolidated: ReturnType<typeof consolidatePayrollMonth>;
      try {
        consolidated = consolidatePayrollMonth(month, enriched, periodId, new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date()));
      } catch (error) { throw new BadRequestException((error as Error).message); }
      const bounds = payrollPeriodBounds(month, 'MONTHLY');
      const fullMonth = sources.length === 1 && sources[0].state.startDate === bounds.startDate && sources[0].state.endDate === bounds.endDate;
      const monthlyId = existing?.id ?? (fullMonth ? sources[0].id : randomUUID());
      const marker = { month, generated: monthlyId !== sources[0].id || sources.length > 1, revisions: monthlyRevisions(sources) };
      const state = { ...consolidated.state,
        ...(!marker.generated ? { payrollGroupId: sources[0].state.payrollGroupId, payrollName: sources[0].state.payrollName ?? consolidated.state.payrollName } : {}),
        monthlyConsolidation: marker };
      const [saved] = await m.query(
        `INSERT INTO jarvis_payroll_documents(id,company_id,employee_id,state,employee_snapshot,parameter_snapshot,accrued,deductions,net) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,employee_snapshot=EXCLUDED.employee_snapshot,parameter_snapshot=EXCLUDED.parameter_snapshot,accrued=EXCLUDED.accrued,deductions=EXCLUDED.deductions,net=EXCLUDED.net,status='DRAFT',updated_at=now()
         WHERE jarvis_payroll_documents.company_id=EXCLUDED.company_id AND jarvis_payroll_documents.status IN ('DRAFT','REJECTED') RETURNING id,updated_at,md5((state - 'monthlyDocumentId' - 'monthlyConsolidation')::text || employee_snapshot::text || parameter_snapshot::text) AS "sourceVersion"`,
        [monthlyId, company, employee, JSON.stringify(state), JSON.stringify(consolidated.worker), JSON.stringify(consolidated.parameters), consolidated.accrued, consolidated.deductions, consolidated.net],
      );
      if (!saved) throw new ConflictException('El mes ya tiene un envío en curso. Actualiza el resumen.');
      if (!marker.generated) {
        marker.revisions = monthlyRevisions([{ ...sources[0], updated_at: saved.updated_at, sourceVersion: saved.sourceVersion }]);
        await m.query("UPDATE jarvis_payroll_documents SET state=jsonb_set(state,'{monthlyConsolidation}',$3::jsonb) WHERE company_id=$1 AND id=$2", [company, monthlyId, JSON.stringify(marker)]);
      } else {
        await m.query("UPDATE jarvis_payroll_documents SET state=jsonb_set(state,'{monthlyDocumentId}',to_jsonb($3::text)) WHERE company_id=$1 AND id=ANY($2::uuid[])", [company, sources.map((row: any) => row.id), monthlyId]);
      }
      await this.audit(m, company, actor, 'PAYROLL_MONTH_CONSOLIDATED', monthlyId);
      return monthlyId;
    });
    return this.get(company, id);
  }

  private async verifyMonthlySources(m: EntityManager, company: string, document: any) {
    const marker = document.state.monthlyConsolidation;
    if (!marker) return;
    const rows = await m.query(
      "SELECT *, md5((state - 'monthlyDocumentId' - 'monthlyConsolidation')::text || employee_snapshot::text || parameter_snapshot::text) AS \"sourceVersion\" FROM jarvis_payroll_documents WHERE company_id=$1 AND employee_id=$2 AND original_id IS NULL AND state->>'period'=$3 AND (state #>> '{monthlyConsolidation,generated}') IS DISTINCT FROM 'true' ORDER BY id FOR UPDATE",
      [company, document.employee_id, marker.month],
    );
    try { assertMonthlyRevisions(rows, marker.revisions); } catch (error) { throw new ConflictException((error as Error).message); }
  }


  async send(company: string, actor: string, id: string) {
    let started = false;
    const context: PayrollSendLogContext = { company, document: id, stage: 'COMPANY_TOKEN' };
    this.logger.log(`[payroll] PREPARE ${JSON.stringify(context)}`);
    try {
      return await this.performSend(company, actor, id, () => { started = true; }, context);
    } catch (error) {
      this.logSubmissionError(error, context);
      // Preflight failures also belong to this employee. Never overwrite an in-flight/accepted document.
      try {
        if (!started) await this.db.transaction(async m => {
          await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payroll:${company}`]);
          const [document] = await m.query('SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE', [company, id]);
          if (!document || !['DRAFT', 'REJECTED'].includes(document.status)) return;
          const message = error instanceof HttpException ? payrollSubmissionErrors(error.getResponse()).join(' | ') || error.message : 'No se pudo preparar el envío. Revisa la configuración y la conexión con el proveedor.';
          await m.query("UPDATE jarvis_payroll_documents SET status='REJECTED',updated_at=now() WHERE company_id=$1 AND id=$2", [company, id]);
          await m.query('INSERT INTO jarvis_payroll_transmissions(id,company_id,document_id,request,error,completed_at) VALUES($1,$2,$3,$4,$5,now())',
            [randomUUID(), company, id, JSON.stringify({ operation: 'PREPARE' }), message]);
        });
      } catch (persistenceError) {
        this.logSubmissionError(persistenceError, { ...context, stage: 'SAVE_PREPARATION_ERROR' });
      }
      throw error;
    }
  }
  private async performSend(company: string, actor: string, id: string, onStarted: () => void, context: PayrollSendLogContext) {
    const token = await this.catalogs.requireCompanyToken(company);
    context.token = token;
    context.stage = 'ISSUER_CONFIGURATION';
    const [issuer, companyRows] = await Promise.all([
      this.api.getPayrollIssuerConfiguration(token),
      this.db.query('SELECT nit FROM companies WHERE id=$1', [company]),
    ]);
    const issuerErrors = payrollIssuerErrors(companyRows[0]?.nit, issuer);
    if (issuerErrors.length) throw new BadRequestException(issuerErrors.join(' | '));
    context.stage = 'PROVIDER_PLAN';
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
    context.stage = 'JARVIS_QUOTA';
    const prepared = await this.plans.withJarvisQuotaLock(company, async () => {
      await this.plans.assertCanCreateDocuments({
        companyId: company,
        provider: IntegrationProvider.JARVIS,
        documentType: ElectronicDocumentType.PURCHASE_INVOICE,
        quantity: 1,
      });
      context.stage = 'LOAD_DOCUMENT';
      return this.db.transaction(async (m) => {
        await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `payroll:${company}`,
        ]);
        const [d] = await m.query(
          'SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE',
          [company, id],
        );
        if (!d) throw new NotFoundException();
        d.state = payrollDefaultLawDeductions(d.state);
        context.employee = d.employee_id;
        context.month = d.state.period;
        if (!['DRAFT', 'REJECTED'].includes(d.status))
          throw new ConflictException(
            'La nómina ya se envió o tiene un envío pendiente de confirmación.',
          );
        context.stage = 'MONTHLY_SOURCES';
        await this.verifyMonthlySources(m, company, d);
        context.stage = 'NUMBERING';
        await ensurePayrollNumbering(m, company);
        context.stage = 'LOAD_SETTINGS';
        const [s] = await m.query(
          'SELECT * FROM jarvis_payroll_settings WHERE company_id=$1 FOR UPDATE',
          [company],
        );
        context.stage = 'LOAD_WORKER';
        const deletion = Boolean(d.original_id && d.state.noteType === 2);
        let worker = d.employee_snapshot;
        if (!deletion) {
          const [currentEmployee] = await m.query(
            'SELECT data,active FROM jarvis_payroll_employees WHERE company_id=$1 AND id=$2',
            [company, d.employee_id],
          );
          if (!currentEmployee) throw new NotFoundException('El empleado no pertenece a esta empresa.');
          worker = await this.resolveSubmissionWorker(company, d.employee_snapshot, currentEmployee.data);
          const required = [...payrollRequiredDeductionErrors(d.state), ...employeeBankErrors(worker)];
          if (!worker.address?.trim()) required.push('Completa la dirección del empleado.');
          if (!Number.isSafeInteger(worker.municipalityId) || worker.municipalityId! < 1) required.push('Selecciona la ciudad del empleado.');
          if (!Number.isSafeInteger(worker.typeContractId) || worker.typeContractId! < 1) required.push('Selecciona el tipo de contrato del empleado.');
          if (required.length) throw new BadRequestException([...new Set(required)].join(' '));
        }
        const number = d.number ?? Number(d.original_id ? s.next_note_number : s.next_number);
        if (!Number.isSafeInteger(Number(number)) || Number(number) < 1 || Number(number) > PAYROLL_RANGE_TO)
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
          const related = await m.query('SELECT id,status FROM jarvis_payroll_documents WHERE company_id=$1 AND original_id=$2 FOR UPDATE', [company, original.id]);
          if (related.some((note: any) => note.id !== id && ['ACCEPTED', 'PROCESSING', 'UNCERTAIN', 'DRAFT', 'REJECTED'].includes(note.status)))
            throw new ConflictException('El documento ya tiene otro ajuste. Vuelve a consultar el listado.');
          predecessor = payrollPredecessor(original);
        }
        context.stage = 'BUILD_PAYLOAD';
        const defaultPrefix = d.original_id ? PAYROLL_NOTE_PREFIX : PAYROLL_PREFIX;
        const savedPrefix = d.number != null ? d.prefix ?? defaultPrefix : defaultPrefix;
        // Replace the old default only when the provider has not assigned a CUNE.
        const prefix = savedPrefix === 'SETP' && !d.cune ? defaultPrefix : savedPrefix;
        const payload = deletion
          ? buildPayrollDeletionPayload(d.state, worker, Number(number), prefix, predecessor)
          : d.original_id && d.state.noteType === 1
            ? buildPayrollReplacementPayload(d.state, worker, Number(number), prefix, predecessor)
            : buildPayrollPayload(
          d.state,
          worker,
          Number(number),
          prefix,
          predecessor,
          { validation: 'provider' },
        );
        context.stage = 'VALIDATE_PAYLOAD';
        const payloadErrors = payrollPayloadRequiredErrors(payload);
        if (payloadErrors.length) throw new BadRequestException(payloadErrors.join(' | '));
        context.stage = 'SAVE_REQUEST';
        const transmission = randomUUID();
        await m.query(
          'INSERT INTO jarvis_payroll_transmissions(id,company_id,document_id,request) VALUES($1,$2,$3,$4)',
          [transmission, company, id, JSON.stringify(payload)],
        );
        await m.query(
          "UPDATE jarvis_payroll_documents SET status='PROCESSING',number=$3,prefix=$4,sent_at=now(),updated_at=now() WHERE company_id=$1 AND id=$2",
          [company, id, number, payload.prefix],
        );
        if (d.number == null)
          await m.query(
            d.original_id
              ? 'UPDATE jarvis_payroll_settings SET next_note_number=next_note_number+1 WHERE company_id=$1'
              : 'UPDATE jarvis_payroll_settings SET next_number=next_number+1 WHERE company_id=$1',
            [company],
          );
        await this.audit(m, company, actor, 'PAYROLL_SEND_STARTED', id);
        return { payload, transmission, adjustment: !!d.original_id };
      });
    });
    onStarted();
    context.stage = 'PROVIDER_REQUEST';
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
      const httpStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
      context.httpStatus = httpStatus;
      context.providerCode = axios.isAxiosError(error) ? error.code : undefined;
      context.providerMessage = payrollSubmissionErrors(safeError).join(' | ') || (error instanceof Error ? error.message : undefined);
      const duplicate = /procesado anteriormente|already processed|regla:\s*90/i.test(JSON.stringify(safeError));
      const rejected = [400, 422].includes(httpStatus ?? 0) && !payrollCune(safeError) && !duplicate;
      const messages = payrollSubmissionErrors(safeError);
      const message = messages.join(' | ') || (rejected ? 'El proveedor rechazó los datos de la nómina.' : 'No se confirmó el resultado del proveedor; verifica el envío antes de reenviar.');
      // Record the provider failure even if saving its result subsequently fails.
      this.logSubmissionError(error, context);
      context.stage = 'SAVE_PROVIDER_ERROR';
      await this.db.transaction(async (m) => {
        await m.query(
          rejected ? "UPDATE jarvis_payroll_documents SET status='REJECTED',updated_at=now() WHERE company_id=$1 AND id=$2" : "UPDATE jarvis_payroll_documents SET status='UNCERTAIN',updated_at=now() WHERE company_id=$1 AND id=$2",
          [company, id],
        );
        await m.query(
          'UPDATE jarvis_payroll_transmissions SET response=$3,error=$4,completed_at=now() WHERE company_id=$1 AND id=$2',
          [company, prepared.transmission, JSON.stringify(safeError), message],
        );
      });
      context.stage = 'PROVIDER_REQUEST';
      if (rejected) throw new BadRequestException(message);
      throw new ServiceUnavailableException(
        'No se confirmó el envío. Se conservó la solicitud para verificar el resultado antes de reenviar.',
      );
    }
    context.stage = 'PROVIDER_RESULT';
    const validation = parseDianValidationResult(response);
    const status =
      validation?.isValid === true
        ? 'ACCEPTED'
        : validation?.isValid === false || ((response as any)?.success === false && !payrollCune(response) && !/procesado anteriormente|already processed|regla:\s*90/i.test(JSON.stringify(response)))
          ? 'REJECTED'
          : 'UNCERTAIN';
    if (status === 'ACCEPTED') {
      this.logger.log(`[payroll] ACCEPTED company=${company} document=${id} employee=${context.employee} month=${context.month}`);
    } else {
      const messages = payrollSubmissionErrors({ response, validation });
      this.logSubmissionError(new Error(messages.join(' | ') || (status === 'REJECTED'
        ? 'NextPyme o DIAN rechazó la nómina.'
        : 'NextPyme no confirmó la aceptación; verifica el resultado antes de reenviar.')), { ...context, stage: status });
    }
    context.stage = 'SAVE_RESULT';
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
    context.stage = 'LOAD_RESULT';
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
