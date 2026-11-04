import { SiigoPurchaseHistorySyncService } from '../../integration/siigo/siigo-purchase-history-sync.service';
import { SiigoPurchaseSyncJobStatus } from '../../integration/enums/siigo-purchase-sync-job-status.enum';
import { resolveCufeImportRow } from '../helpers/purchase-invoice-cufe.helper';
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfiguration } from '../../config/configuration';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { IntegrationProvider } from '../../integration/enums/integration-provider.enum';
import { JarvisDocumentPreparationService } from '../../integration/jarvis/jarvis-document-preparation.service';
import { NextPymeApiClient } from '../../integration/jarvis/nextpyme/nextpyme-api.client';
import { SiigoDocumentPreparationService } from '../../integration/siigo/siigo-document-preparation.service';
import { SiigoPurchaseAiClassificationService } from '../../integration/siigo/siigo-purchase-ai-classification.service';
import { mapWithConcurrency } from '../../common/helpers/concurrency.helper';
import { mapNextPymeInvoiceQueryToElectronicDocumentPayload } from '../../electronic-document/mappers/nextpyme-invoice-query-to-payload.mapper';
import { PostgresNotifyService } from '../../realtime/postgres-notify.service';
import {
  DianSalesInvoiceRow,
  mapDianSalesInvoiceRowToPayload,
} from '../helpers/sales-invoice-excel.helper';
import { PurchaseInvoiceImportJob } from '../entities/purchase-invoice-import-job.entity';
import { PurchaseInvoiceImportJobRow } from '../entities/purchase-invoice-import-job-row.entity';
import { PurchaseInvoiceImportRecord } from '../interfaces/purchase-invoice-import-result.interface';
import { PurchaseInvoiceImportJobStatus } from '../enums/purchase-invoice-import-job-status.enum';
import { PurchaseInvoiceImportRowStatus } from '../enums/purchase-invoice-import-row-status.enum';
import { PurchaseInvoiceImportJobsRepository } from '../repositories/purchase-invoice-import-jobs.repository';
import { PurchaseInvoiceImportJobRowsRepository } from '../repositories/purchase-invoice-import-job-rows.repository';
import { PurchaseInvoiceImportStatusService } from './purchase-invoice-import-status.service';

/** Procesa los jobs recibidos desde una solicitud, sin temporizadores. */
@Injectable()
export class PurchaseInvoiceImportWorkerService
  implements OnApplicationShutdown
{
  private readonly logger = new Logger(PurchaseInvoiceImportWorkerService.name);
  private stopped = false;
  private readonly activeJobs = new Map<string, Promise<void>>();
  /** Timestamp del fin del último lote procesado por job — instrumentación
   * temporal para medir el "hueco" entre lotes de un mismo job (ver
   * BATCH METRICS más abajo); no es necesaria para el funcionamiento del
   * worker, solo para diagnosticar throughput. */
  private readonly lastBatchEndByJobId = new Map<string, number>();

  constructor(
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly companiesRepository: CompaniesRepository,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly nextPymeApiClient: NextPymeApiClient,
    private readonly siigoDocumentPreparationService: SiigoDocumentPreparationService,
    private readonly siigoPurchaseAiClassificationService: SiigoPurchaseAiClassificationService,
    private readonly jarvisDocumentPreparationService: JarvisDocumentPreparationService,
    private readonly purchaseInvoiceImportJobsRepository: PurchaseInvoiceImportJobsRepository,
    private readonly purchaseInvoiceImportJobRowsRepository: PurchaseInvoiceImportJobRowsRepository,
    private readonly purchaseInvoiceImportStatusService: PurchaseInvoiceImportStatusService,
    private readonly postgresNotifyService: PostgresNotifyService,
    private readonly siigoPurchaseHistorySyncService: SiigoPurchaseHistorySyncService,
  ) {}

  onApplicationShutdown(): void {
    this.stopped = true;
  }

  isRunning(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  /** Solo se inicia después de que una solicitud persista todas sus filas. */
  start(jobId: string): Promise<void> {
    const active = this.activeJobs.get(jobId);
    if (active) return active;
    if (this.stopped) return Promise.resolve();
    const work = Promise.resolve()
      .then(() => this.processJob(jobId))
      .catch(async (error: unknown) => {
        this.logger.error(
          `Error procesando la importación ${jobId}`,
          error instanceof Error ? error.stack : String(error),
        );
        await this.purchaseInvoiceImportJobsRepository.patch(jobId, {
          status: PurchaseInvoiceImportJobStatus.ERROR,
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        });
      })
      .catch((error: unknown) => {
        this.logger.error(`No se pudo guardar el error de ${jobId}`, String(error));
      })
      .finally(() => {
        this.activeJobs.delete(jobId);
        this.lastBatchEndByJobId.delete(jobId);
      });
    this.activeJobs.set(jobId, work);
    return work;
  }

  private async processJob(jobId: string): Promise<void> {
    while (!this.stopped) {
      const job = await this.purchaseInvoiceImportJobsRepository.findById(jobId);
      if (!job || ![
        PurchaseInvoiceImportJobStatus.PENDING,
        PurchaseInvoiceImportJobStatus.RUNNING,
      ].includes(job.status)) return;
      if (!(await this.processOneBatchForJob(job))) return;
    }
  }

  private async processOneBatchForJob(
    job: PurchaseInvoiceImportJob,
  ): Promise<boolean> {
    const outstanding =
      await this.purchaseInvoiceImportJobRowsRepository.countOutstandingByJob(
        job.id,
      );

    if (outstanding === 0) {
      await this.finalizeJob(job);
      return false;
    }

    // El cupo del plan ya NO limita ni aborta la importación: solo se
    // valida/descuenta al momento de ENVIAR el documento a SIIGO (ver
    // assertCanCreateDocuments en SiigoPurchaseSendService), que es cuando
    // realmente cuenta contra el plan. Importar el Excel crea los registros
    // locales sin importar cuántos quepan en el cupo restante.
    if (job.status === PurchaseInvoiceImportJobStatus.PENDING) {
      await this.purchaseInvoiceImportJobsRepository.patch(job.id, {
        status: PurchaseInvoiceImportJobStatus.RUNNING,
      });
    }

    if (!(await this.isPurchaseHistoryReady(job))) return false;

    const batchSize = this.configService.get(
      'purchaseInvoiceImport.batchSize',
      { infer: true },
    );
    const claimStartedAt = Date.now();
    const batch =
      await this.purchaseInvoiceImportJobRowsRepository.claimPendingBatch(
        job.id,
        batchSize,
      );
    const claimDurationMs = Date.now() - claimStartedAt;

    if (batch.length === 0) {
      // Otro worker puede tener las filas reclamadas. No consultar en bucle.
      return false;
    }

    const batchStartedAt = Date.now();
    const previousBatchEndedAt = this.lastBatchEndByJobId.get(job.id);
    const gapSinceLastBatchMs =
      previousBatchEndedAt != null
        ? batchStartedAt - previousBatchEndedAt
        : null;

    this.logger.log(
      `[job=${job.id}] Procesando lote de ${batch.length} fila(s).`,
    );

    const nextPymeToken = await this.resolveCompanyNextPymeToken(job.companyId);

    // Instrumentación de concurrencia real: si nextPymeMaxConcurrent en el
    // log final resulta ser 1, las llamadas se están sirializando en algún
    // lado (a pesar de que mapWithConcurrency debería paralelizarlas hasta
    // el límite configurado) — esto lo prueba con datos en vez de asumirlo
    // por lectura de código.
    let nextPymeInFlight = 0;
    let nextPymeMaxConcurrent = 0;
    const concurrency = this.configService.get(
      'purchaseInvoiceImport.concurrency',
      { infer: true },
    );

    const nextPymeStartedAt = Date.now();
    const results = await mapWithConcurrency(
      batch,
      concurrency,
      async (jobRow) => {
        nextPymeInFlight += 1;
        nextPymeMaxConcurrent = Math.max(
          nextPymeMaxConcurrent,
          nextPymeInFlight,
        );

        try {
          return await this.buildPurchaseInvoicePayload(
            jobRow.rawRow as DianSalesInvoiceRow,
            nextPymeToken,
            job.companyId,
          );
        } finally {
          nextPymeInFlight -= 1;
        }
      },
    );
    const nextPymeDurationMs = Date.now() - nextPymeStartedAt;
    const nextPymeRetryCount = results.reduce(
      (sum, result) => sum + Math.max(0, result.nextPymeAttempts - 1),
      0,
    );
    const nextPymeRetryWaitMs = results.reduce(
      (sum, result) => sum + result.nextPymeRetryDelayMs,
      0,
    );

    if (nextPymeMaxConcurrent <= 1 && batch.length > 1) {
      this.logger.warn(
        `[job=${job.id}] Las consultas a NextPyme de este lote nunca se solaparon (máximo ${nextPymeMaxConcurrent} en simultáneo con ${batch.length} filas) — revisar si se están ejecutando secuencialmente en vez de con concurrencia ${concurrency}.`,
      );
    }

    const successfulRows: Array<{
      row: DianSalesInvoiceRow;
      payload: ReturnType<typeof mapDianSalesInvoiceRowToPayload>;
      jobRow: PurchaseInvoiceImportJobRow;
    }> = [];
    const processedAt = new Date();

    batch.forEach((jobRow, index) => {
      const result = results[index];
      jobRow.processedAt = processedAt;

      if (result.failed) {
        jobRow.status = PurchaseInvoiceImportRowStatus.FAILED;
        jobRow.errorMessage = result.errorReason;
      } else {
        jobRow.status = PurchaseInvoiceImportRowStatus.SUCCESS;
        if (jobRow.rawRow?.importSource === 'CUFE') {
          jobRow.issuerNit = jobRow.rawRow.issuerNit;
          jobRow.issuerName = jobRow.rawRow.issuerName;
        }
        successfulRows.push({
          row: jobRow.rawRow as DianSalesInvoiceRow,
          payload: result.payload,
          jobRow,
        });
      }
    });

    const pgUpdateRowsStartedAt = Date.now();
    await this.purchaseInvoiceImportJobRowsRepository.saveMany(batch);
    let pgUpdateMs = Date.now() - pgUpdateRowsStartedAt;

    const nextPymeSuccessCount = successfulRows.length;
    const nextPymeFailedCount = batch.length - nextPymeSuccessCount;

    // Se crean los documentos de ESTE lote de inmediato (no se espera a que
    // terminen todos los lotes del job) — si el proceso muere después de
    // este punto, lo ya creado acá queda commiteado y no se reprocesa.
    // NOTA sobre lo que mide siigoJarvisMs: acá solo se crea el registro
    // local de ElectronicDocument (transacción propia en Postgres) — el
    // push real a la API de SIIGO/Jarvis ocurre por separado, en segundo
    // plano, vía prepareDocumentsInBackground (fire-and-forget, no bloquea
    // este batch ni antes ni ahora). Si el cuello de botella resultara
    // estar acá, es tiempo de Postgres, no de una llamada HTTP a SIIGO.
    let documentsCreated = 0;
    let documentsReused = 0;
    let itemsTotal = 0;
    let documentsSkippedByPlanLimit = 0;
    let siigoJarvisDurationMs = 0;
    const createdDocumentIds: string[] = [];
    const records: PurchaseInvoiceImportRecord[] = [];

    if (successfulRows.length > 0) {
      const rowsWithPayload = successfulRows.map(({ row, payload }) => ({
        issuerNit: row.issuerNit,
        issuerName: row.issuerName,
        payload,
      }));

      const siigoJarvisStartedAt = Date.now();
      const creationResult =
        await this.electronicDocumentService.createFromPurchaseInvoiceRows(
          rowsWithPayload,
          job.companyId,
          job.provider ?? undefined,
        );
      siigoJarvisDurationMs = Date.now() - siigoJarvisStartedAt;

      documentsCreated = creationResult.documentsCreated;
      documentsReused = creationResult.documentsReused;
      itemsTotal = creationResult.itemsTotal;
      documentsSkippedByPlanLimit = creationResult.documentsSkippedByPlanLimit;

      const resultByCufe = new Map(
        creationResult.rows.map((row) => [row.cufe, row]),
      );
      // Documentos que se crearon directo en PURCHASE_CREATED porque ya
      // existían en SIIGO (matcheados por provider_invoice, ver
      // createFromPurchaseInvoiceRows) — no van al pipeline de
      // clasificación/envío automático de más abajo, ya están listos.
      const documentIdsAlreadyInSiigo: string[] = [];
      // Documentos REUSADOS (mismo CUFE que un ElectronicDocument ya
      // existente, ver existingDocumentIdByCufe en
      // createFromPurchaseInvoiceRows) — ya se procesaron en un import
      // anterior; reimportar el mismo Excel no debe volver a disparar
      // validación de proveedor/cuenta, ni hacer que el frontend se quede
      // esperando un cambio de estado que nunca va a llegar (bug real
      // reportado: "la revisión de proveedores está tardando más de lo
      // normal" al reimportar facturas que ya estaban en BD).
      const documentIdsReused: string[] = [];

      successfulRows.forEach(({ row, jobRow }) => {
        const creationRow = row.cufe ? resultByCufe.get(row.cufe) : undefined;

        if (creationRow?.documentId) {
          jobRow.documentId = creationRow.documentId;

          if (creationRow.reused) {
            documentIdsReused.push(creationRow.documentId);
          } else {
            createdDocumentIds.push(creationRow.documentId);
          }

          if (creationRow.alreadyInSiigo) {
            documentIdsAlreadyInSiigo.push(creationRow.documentId);
          }

          records.push({
            cufe: row.cufe,
            documentType: row.documentType,
            issueDate: row.issueDate,
            receptionDate: row.receptionDate,
            issuerNit: row.issuerNit,
            issuerName: row.issuerName,
            receiverNit: row.receiverNit,
            receiverName: row.receiverName,
            currency: row.currency,
            paymentMethod: row.paymentForm || row.paymentMethod,
            total: row.total,
            status: row.status,
            group: row.group,
          });
        } else if (creationRow?.skippedByPlanLimit) {
          jobRow.status = PurchaseInvoiceImportRowStatus.FAILED;
          jobRow.errorMessage =
            'No se creó: se alcanzó el límite de documentos del plan.';
          jobRow.processedAt = new Date();
        }
      });

      const pgUpdateDocsStartedAt = Date.now();
      await this.purchaseInvoiceImportJobRowsRepository.saveMany(
        successfulRows.map(({ jobRow }) => jobRow),
      );
      pgUpdateMs += Date.now() - pgUpdateDocsStartedAt;

      const documentIdsPendingProcessing =
        documentIdsAlreadyInSiigo.length > 0
          ? createdDocumentIds.filter(
              (id) => !documentIdsAlreadyInSiigo.includes(id),
            )
          : createdDocumentIds;

      if (documentIdsAlreadyInSiigo.length > 0) {
        this.logger.log(
          `[job=${job.id}] ${documentIdsAlreadyInSiigo.length} factura(s) ya existían en SIIGO — creadas directo como listas, sin pasar por clasificación/envío automático.`,
        );
      }

      if (documentIdsReused.length > 0) {
        this.logger.log(
          `[job=${job.id}] ${documentIdsReused.length} factura(s) reusaron un documento ya existente (mismo CUFE) — no vuelven a pasar por validación de proveedor/cuenta.`,
        );
      }

      if (documentIdsPendingProcessing.length > 0) {
        const provider =
          job.provider ?? await this.electronicDocumentService.resolveDocumentProvider(
            job.companyId,
          );

        this.logger.log(
          `[job=${job.id}] [companyId=${job.companyId}] Validación de proveedores: provider=${provider}, documents=${documentIdsPendingProcessing.length}.`,
        );

        if (provider === IntegrationProvider.JARVIS) {
          this.jarvisDocumentPreparationService.prepareDocumentsInBackground(
            documentIdsPendingProcessing,
            job.companyId,
          );
        } else {
          this.siigoDocumentPreparationService.prepareDocumentsInBackground(
            documentIdsPendingProcessing,
            job.companyId,
          );
        }
      }
      const aiDocumentIds = [
        ...new Set([...documentIdsPendingProcessing, ...documentIdsReused]),
      ].filter((id) => !documentIdsAlreadyInSiigo.includes(id));
      if (
        aiDocumentIds.length &&
        (job.provider ?? await this.electronicDocumentService.resolveDocumentProvider(
          job.companyId,
        )) === IntegrationProvider.SIIGO
      ) {
        this.siigoPurchaseAiClassificationService.classifyDocumentsInBackground(
          aiDocumentIds,
          job.companyId,
        );
      }
    }

    const pgUpdateJobStartedAt = Date.now();
    await this.purchaseInvoiceImportJobsRepository.applyBatchResults(job.id, {
      itemsTotal,
      documentsCreated,
      documentsReused,
      documentIds: createdDocumentIds,
      records,
    });
    pgUpdateMs += Date.now() - pgUpdateJobStartedAt;

    const totalBatchDurationMs = Date.now() - batchStartedAt;
    this.lastBatchEndByJobId.set(job.id, Date.now());

    this.logger.log(
      `[job=${job.id}] Lote terminado en ${totalBatchDurationMs}ms — NextPyme: ${nextPymeSuccessCount} éxito(s)/${nextPymeFailedCount} fallo(s); documentos creados=${documentsCreated}, reusados=${documentsReused}, sin cupo=${documentsSkippedByPlanLimit}.`,
    );
    this.logger.log(
      `[job=${job.id}] BATCH METRICS rows=${batch.length} claimMs=${claimDurationMs} nextPymeMs=${nextPymeDurationMs} nextPymeMaxConcurrent=${nextPymeMaxConcurrent} nextPymeRetries=${nextPymeRetryCount} nextPymeRetryWaitMs=${nextPymeRetryWaitMs} siigoJarvisMs=${siigoJarvisDurationMs} pgUpdateMs=${pgUpdateMs} totalBatchMs=${totalBatchDurationMs} gapSinceLastBatchMs=${gapSinceLastBatchMs ?? 'n/a'}`,
    );

    await this.notifyBatchProgress(job, batch);
    return true;
  }

  /** Espera la promesa del sync, sin consultas de estado en bucle. */
  private async isPurchaseHistoryReady(job: PurchaseInvoiceImportJob): Promise<boolean> {
    const provider = job.provider ?? await this.electronicDocumentService.resolveDocumentProvider(job.companyId);
    if (provider !== IntegrationProvider.SIIGO || job.processedRows > 0) return true;
    try {
      const sync = await this.siigoPurchaseHistorySyncService.getLatestStatus(job.companyId);
      const completedForImport = sync?.completedAt != null &&
        sync.completedAt.getTime() >= job.startedAt.getTime();
      if (completedForImport && sync?.status === SiigoPurchaseSyncJobStatus.COMPLETED) return true;
      if (completedForImport && sync?.status === SiigoPurchaseSyncJobStatus.ERROR) {
        throw new Error(sync.errorMessage || 'La sincronización de compras no se completó.');
      }
      await this.siigoPurchaseHistorySyncService.syncAndWait(job.companyId);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Error al consultar SIIGO.';
      await this.purchaseInvoiceImportJobsRepository.patch(job.id, {
        status: PurchaseInvoiceImportJobStatus.ERROR,
        errorMessage: 'No se pudo sincronizar las compras de SIIGO antes de importar. ' + reason + ' Vuelve a importar para reintentar.',
        completedAt: new Date(),
      });
      await this.notifyCompleted(job.id, job.companyId);
      return false;
    }
  }

  private async finalizeJob(job: PurchaseInvoiceImportJob): Promise<void> {
    const counts =
      await this.purchaseInvoiceImportJobRowsRepository.countByStatus(job.id);
    const successCount =
      counts.find(
        (entry) => entry.status === PurchaseInvoiceImportRowStatus.SUCCESS,
      )?.count ?? 0;
    const failedCount =
      counts.find(
        (entry) => entry.status === PurchaseInvoiceImportRowStatus.FAILED,
      )?.count ?? 0;

    await this.purchaseInvoiceImportJobsRepository.patch(job.id, {
      status: PurchaseInvoiceImportJobStatus.COMPLETED,
      // Filas realmente terminadas, mismo criterio que notifyBatchProgress.
      // Antes se guardaba job.totalRows, que con un job todavía sin ese dato
      // en memoria escribía 0 aunque hubiera filas procesadas.
      processedRows: successCount + failedCount,
      completedAt: new Date(),
    });

    const finalJob = await this.purchaseInvoiceImportJobsRepository.findById(
      job.id,
    );
    this.logger.log(
      `[job=${job.id}] Facturas de compra DIAN: importación completada (documentos=${finalJob?.documentsCreated ?? 0}, fallidas=${failedCount}).`,
    );

    await this.notifyCompleted(job.id, job.companyId);
  }

  private async notifyBatchProgress(
    job: PurchaseInvoiceImportJob,
    batch: PurchaseInvoiceImportJobRow[],
  ): Promise<void> {
    const counts =
      await this.purchaseInvoiceImportJobRowsRepository.countByStatus(job.id);
    const successCount =
      counts.find(
        (entry) => entry.status === PurchaseInvoiceImportRowStatus.SUCCESS,
      )?.count ?? 0;
    const errorCount =
      counts.find(
        (entry) => entry.status === PurchaseInvoiceImportRowStatus.FAILED,
      )?.count ?? 0;
    const processedRows = successCount + errorCount;

    await this.purchaseInvoiceImportJobsRepository.patch(job.id, {
      processedRows,
    });

    await this.postgresNotifyService.publish({
      event: 'progress',
      companyId: job.companyId,
      payload: {
        jobId: job.id,
        processedRows,
        totalRows: job.totalRows,
        successCount,
        errorCount,
        progressPercent: job.totalRows
          ? Math.round((processedRows / job.totalRows) * 100)
          : null,
      },
    });

    for (const jobRow of batch) {
      if (
        jobRow.status !== PurchaseInvoiceImportRowStatus.SUCCESS &&
        jobRow.status !== PurchaseInvoiceImportRowStatus.FAILED
      ) {
        continue;
      }

      await this.postgresNotifyService.publish({
        event: 'row',
        companyId: job.companyId,
        payload: {
          jobId: job.id,
          rowIndex: jobRow.rowIndex,
          cufe: jobRow.cufe,
          issuerNit: jobRow.issuerNit,
          issuerName: jobRow.issuerName,
          status: jobRow.status,
          errorMessage: jobRow.errorMessage,
          documentId: jobRow.documentId,
        },
      });
    }
  }

  private async notifyCompleted(
    jobId: string,
    companyId: string,
  ): Promise<void> {
    const finalStatus = await this.purchaseInvoiceImportStatusService.getStatus(
      jobId,
      companyId,
    );

    await this.postgresNotifyService.publish({
      event: 'completed',
      companyId,
      payload: finalStatus,
    });
  }

  /** Token propio de NextPyme de la empresa, si lo configuró un admin; si
   * no, `undefined` (el cliente rechaza la consulta). */
  private async resolveCompanyNextPymeToken(
    companyId: string,
  ): Promise<string | undefined> {
    const trimmedCompanyId = companyId.trim();

    if (!trimmedCompanyId) {
      return undefined;
    }

    const company = await this.companiesRepository.findById(trimmedCompanyId);

    return company?.nextPymeToken?.trim() || undefined;
  }

  private async buildPurchaseInvoicePayload(
    row: DianSalesInvoiceRow,
    nextPymeToken?: string,
    companyId?: string,
  ): Promise<
    | {
        failed: false;
        payload: ReturnType<typeof mapDianSalesInvoiceRowToPayload>;
        nextPymeAttempts: number;
        nextPymeRetryDelayMs: number;
      }
    | {
        failed: true;
        errorReason: string;
        nextPymeAttempts: number;
        nextPymeRetryDelayMs: number;
      }
  > {
    if (!row.cufe) {
      return {
        failed: false,
        payload: mapDianSalesInvoiceRowToPayload(row),
        nextPymeAttempts: 0,
        nextPymeRetryDelayMs: 0,
      };
    }

    const lookup = await this.nextPymeApiClient.getInvoiceByCufe(
      row.cufe,
      nextPymeToken,
    );
    const nextPymeAttempts = lookup.attempts;
    const nextPymeRetryDelayMs = lookup.retryDelayMs;

    if (lookup.outcome === 'error') {
      // getInvoiceByCufe ya reintentó (solo para errores clasificados como
      // transitorios) — si sigue fallando acá, no se usa el Excel como
      // reemplazo (el dato debe venir siempre de NextPyme): se omite la
      // fila y se reporta, con un mensaje que deja claro que es un
      // problema de consulta y no que la factura no exista.
      this.logger.warn(
        `[cufe=${row.cufe}] No se pudo consultar NextPyme (${lookup.message}); se omite el registro.`,
      );
      return {
        failed: true,
        errorReason: lookup.retryable
          ? 'No se pudo consultar la factura en NextPyme tras varios intentos. Vuelve a intentar la importación más tarde.'
          : `No se pudo consultar la factura en NextPyme: ${lookup.message}`,
        nextPymeAttempts,
        nextPymeRetryDelayMs,
      };
    }

    if (lookup.outcome === 'not_found') {
      this.logger.warn(
        `[cufe=${row.cufe}] No se encontró la factura en NextPyme; se omite el registro del Excel.`,
      );
      return {
        failed: true,
        errorReason: 'No se encontró la factura al consultarla en NextPyme.',
        nextPymeAttempts,
        nextPymeRetryDelayMs,
      };
    }

    const payload = mapNextPymeInvoiceQueryToElectronicDocumentPayload(
      lookup.data,
      row.cufe,
    );

    if (row.importSource === 'CUFE') {
      try {
        const company = companyId ? await this.companiesRepository.findById(companyId) : null;
        Object.assign(row, resolveCufeImportRow(lookup.data, payload, company?.nit));
      } catch (error) {
        return { failed: true, errorReason: error instanceof Error ? error.message : 'No se pudo validar la factura consultada.', nextPymeAttempts, nextPymeRetryDelayMs };
      }
    }

    if (!(payload.totals.total > 0)) {
      this.logger.warn(
        `[cufe=${row.cufe}] La respuesta de NextPyme no trae montos válidos; se usa el resumen del Excel de la DIAN.`,
      );
      return {
        failed: false,
        payload: mapDianSalesInvoiceRowToPayload(row),
        nextPymeAttempts,
        nextPymeRetryDelayMs,
      };
    }

    return { failed: false, payload, nextPymeAttempts, nextPymeRetryDelayMs };
  }
}
