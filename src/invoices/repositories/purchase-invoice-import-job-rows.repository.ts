import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoiceImportJobRow } from '../entities/purchase-invoice-import-job-row.entity';
import { PurchaseInvoiceImportRowStatus } from '../enums/purchase-invoice-import-row-status.enum';

export interface PurchaseInvoiceImportRowStatusCount {
  status: PurchaseInvoiceImportRowStatus;
  count: number;
}

@Injectable()
export class PurchaseInvoiceImportJobRowsRepository {
  constructor(
    @InjectRepository(PurchaseInvoiceImportJobRow)
    private readonly repository: Repository<PurchaseInvoiceImportJobRow>,
  ) {}

  create(
    data: Pick<
      PurchaseInvoiceImportJobRow,
      'jobId' | 'rowIndex' | 'cufe' | 'issuerNit' | 'issuerName' | 'rawRow'
    >,
  ): PurchaseInvoiceImportJobRow {
    return this.repository.create(data);
  }

  saveMany(
    rows: PurchaseInvoiceImportJobRow[],
  ): Promise<PurchaseInvoiceImportJobRow[]> {
    return this.repository.save(rows);
  }

  /** Cuenta filas por estado para armar el progreso (% avanzado, éxitos/errores). */
  async countByStatus(
    jobId: string,
  ): Promise<PurchaseInvoiceImportRowStatusCount[]> {
    const rows = await this.repository
      .createQueryBuilder('row')
      .select('row.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('row.job_id = :jobId', { jobId })
      .groupBy('row.status')
      .getRawMany<{ status: PurchaseInvoiceImportRowStatus; count: string }>();

    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    }));
  }

  findFailedByJob(
    jobId: string,
    limit = 200,
  ): Promise<PurchaseInvoiceImportJobRow[]> {
    return this.repository.find({
      where: { jobId, status: PurchaseInvoiceImportRowStatus.FAILED },
      order: { rowIndex: 'ASC' },
      take: limit,
    });
  }

  findByJob(jobId: string): Promise<PurchaseInvoiceImportJobRow[]> {
    return this.repository.find({
      where: { jobId },
      order: { rowIndex: 'ASC' },
    });
  }

  /** Vuelve a 'pending' las filas fallidas de un job (para "reintentar solo
   * las fallidas") — limpia el motivo de error y la marca de procesado
   * previos para que se traten como filas nuevas en la próxima corrida. */
  async resetFailedRowsToPending(jobId: string): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PurchaseInvoiceImportJobRow)
      .set({
        status: PurchaseInvoiceImportRowStatus.PENDING,
        errorMessage: null,
        processedAt: null,
      })
      .where('job_id = :jobId AND status = :status', {
        jobId,
        status: PurchaseInvoiceImportRowStatus.FAILED,
      })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Reclama hasta `batchSize` filas 'pending' de un job y las marca
   * 'processing' de forma atómica — `FOR UPDATE SKIP LOCKED` hace que, si
   * hay más de un worker corriendo a la vez, cada uno se lleve un lote
   * distinto en vez de pisarse. La transacción dura solo esto (seleccionar
   * + marcar); las llamadas a NextPyme/SIIGO ocurren después, ya sin
   * ninguna transacción abierta.
   */
  async claimPendingBatch(
    jobId: string,
    batchSize: number,
  ): Promise<PurchaseInvoiceImportJobRow[]> {
    return this.repository.manager.transaction(async (manager) => {
      const rows = await manager
        .createQueryBuilder(PurchaseInvoiceImportJobRow, 'row')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('row.job_id = :jobId', { jobId })
        .andWhere('row.status = :status', {
          status: PurchaseInvoiceImportRowStatus.PENDING,
        })
        .orderBy('row.row_index', 'ASC')
        .limit(batchSize)
        .getMany();

      if (rows.length === 0) {
        return [];
      }

      const claimedAt = new Date();

      await manager
        .createQueryBuilder()
        .update(PurchaseInvoiceImportJobRow)
        .set({
          status: PurchaseInvoiceImportRowStatus.PROCESSING,
          processingAt: claimedAt,
          attempts: () => 'attempts + 1',
        })
        .whereInIds(rows.map((row) => row.id))
        .execute();

      return rows.map((row) => ({
        ...row,
        status: PurchaseInvoiceImportRowStatus.PROCESSING,
        processingAt: claimedAt,
        attempts: row.attempts + 1,
      }));
    });
  }

  /** Barrido global (no por job): filas que quedaron 'processing' porque el
   * worker que las reclamó murió antes de terminar — vuelven a 'pending'
   * para que cualquier worker las retome. */
  async recoverAbandonedRows(timeoutMinutes: number): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PurchaseInvoiceImportJobRow)
      .set({
        status: PurchaseInvoiceImportRowStatus.PENDING,
        processingAt: null,
      })
      .where('status = :status', {
        status: PurchaseInvoiceImportRowStatus.PROCESSING,
      })
      .andWhere(
        'processing_at < now() - make_interval(mins => :timeoutMinutes)',
        {
          timeoutMinutes,
        },
      )
      .execute();

    return result.affected ?? 0;
  }

  /** Filas que todavía no llegaron a un estado final ('pending' o
   * 'processing') — mientras sea > 0, el job no puede darse por terminado. */
  countOutstandingByJob(jobId: string): Promise<number> {
    return this.repository.count({
      where: [
        { jobId, status: PurchaseInvoiceImportRowStatus.PENDING },
        { jobId, status: PurchaseInvoiceImportRowStatus.PROCESSING },
      ],
    });
  }
}
