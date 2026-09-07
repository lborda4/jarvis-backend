import { Injectable } from '@nestjs/common';
import { PurchaseInvoiceImportJob } from '../entities/purchase-invoice-import-job.entity';
import { PurchaseInvoiceImportJobRowsRepository } from '../repositories/purchase-invoice-import-job-rows.repository';
import { PurchaseInvoiceImportJobsRepository } from '../repositories/purchase-invoice-import-jobs.repository';
import { PurchaseInvoiceImportRowStatus } from '../enums/purchase-invoice-import-row-status.enum';
import {
  PurchaseInvoiceImportFailedRowDetailDto,
  PurchaseInvoiceImportStatusResponseDto,
} from '../dto/purchase-invoice-import-job.dto';

/** Filas fallidas devueltas en el detalle del estado del job — un import de
 * 500+ filas con muchos errores no debe mandar un payload gigante en cada
 * consulta de estado (REST o snapshot de WebSocket). */
const PURCHASE_INVOICE_IMPORT_MAX_FAILED_ROWS_IN_STATUS = 200;

/**
 * Lectura del estado de un job de importación de Factura de compra —
 * extraído de InvoicesService para que tanto el controller REST
 * (GET .../status) como el gateway de WebSocket (snapshot al suscribirse)
 * usen exactamente la misma lógica y el mismo chequeo de tenant, sin que el
 * gateway tenga que depender de todo InvoicesModule.
 */
@Injectable()
export class PurchaseInvoiceImportStatusService {
  constructor(
    private readonly purchaseInvoiceImportJobsRepository: PurchaseInvoiceImportJobsRepository,
    private readonly purchaseInvoiceImportJobRowsRepository: PurchaseInvoiceImportJobRowsRepository,
  ) {}

  async getStatus(
    jobId: string,
    companyId: string,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
    const job = await this.purchaseInvoiceImportJobsRepository.findById(jobId);

    if (!job || job.companyId !== companyId) {
      return this.buildEmptyImportStatusResponse();
    }

    return this.buildImportStatusResponse(job);
  }

  async getLatestStatus(
    companyId: string,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
    const job =
      await this.purchaseInvoiceImportJobsRepository.findLatestByCompany(
        companyId,
      );

    if (!job) {
      return this.buildEmptyImportStatusResponse();
    }

    return this.buildImportStatusResponse(job);
  }

  buildEmptyImportStatusResponse(): PurchaseInvoiceImportStatusResponseDto {
    return {
      jobId: null,
      status: null,
      processedRows: 0,
      totalRows: null,
      successCount: 0,
      errorCount: 0,
      progressPercent: null,
      itemsTotal: null,
      documentsCreated: null,
      documentIds: null,
      records: null,
      failedRows: [],
      validation: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
    };
  }

  async buildImportStatusResponse(
    job: PurchaseInvoiceImportJob,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
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

    const failedRowRecords =
      errorCount > 0
        ? await this.purchaseInvoiceImportJobRowsRepository.findFailedByJob(
            job.id,
            PURCHASE_INVOICE_IMPORT_MAX_FAILED_ROWS_IN_STATUS,
          )
        : [];

    const failedRows: PurchaseInvoiceImportFailedRowDetailDto[] =
      failedRowRecords.map((row) => ({
        rowIndex: row.rowIndex,
        cufe: row.cufe,
        issuerNit: row.issuerNit,
        issuerName: row.issuerName,
        errorMessage: row.errorMessage ?? '',
      }));

    return {
      jobId: job.id,
      status: job.status,
      // Derivado de los MISMOS conteos que successCount/errorCount, no de la
      // columna job.processedRows: esa la mantiene el worker por separado y
      // podía quedar desfasada, dejando a la vista un "0 de 12 procesados"
      // junto a "12 exitosas" y la barra al 100% (bug real reportado). Lo
      // procesado ES lo que ya terminó bien o mal, así que sale de ahí.
      processedRows: successCount + errorCount,
      totalRows: job.totalRows,
      successCount,
      errorCount,
      // job.totalRows === 0 (Excel sin filas para procesar) es "ya
      // terminado", no "sin dato" — antes `job.totalRows ? ... : null`
      // trataba 0 como falsy y devolvía null también en ese caso, dejando
      // la barra de progreso sin completar para un job que en realidad ya
      // estaba COMPLETED.
      progressPercent:
        job.totalRows === 0
          ? 100
          : job.totalRows
            ? Math.round(((successCount + errorCount) / job.totalRows) * 100)
            : null,
      itemsTotal: job.itemsTotal,
      documentsCreated: job.documentsCreated,
      documentIds: job.documentIds,
      records: job.records,
      failedRows,
      validation: job.validationReport,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }
}
