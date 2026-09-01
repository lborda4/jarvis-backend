import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PurchaseInvoiceImportRowStatus } from '../enums/purchase-invoice-import-row-status.enum';
import { PurchaseInvoiceImportJob } from './purchase-invoice-import-job.entity';
import { DianSalesInvoiceRow } from '../helpers/sales-invoice-excel.helper';

/**
 * Una fila por cada registro del Excel de un job de importación de Factura
 * de compra. Se inserta con status=pending ANTES de procesar nada (así, si
 * el servidor se cae a mitad de camino, queda registrado exactamente qué
 * filas se alcanzaron a procesar y cuáles no, sin depender de que el job
 * termine para saber algo) y se actualiza por lotes a medida que se
 * procesa (ver PurchaseInvoiceImportWorkerService). La tabla misma actúa
 * como cola: el worker reclama lotes de filas 'pending' con
 * SELECT ... FOR UPDATE SKIP LOCKED (ver claimPendingBatch en el
 * repositorio), sin depender de Redis/BullMQ.
 */
@Entity('purchase_invoice_import_job_rows')
@Index('IDX_purchase_invoice_import_job_rows_job', ['jobId', 'status'])
@Index('IDX_purchase_invoice_import_job_rows_job_order', [
  'jobId',
  'rowIndex',
])
export class PurchaseInvoiceImportJobRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  /** Posición de la fila en el Excel original (para orden estable / referencia al reportarle errores al usuario). */
  @Column({ name: 'row_index', type: 'integer' })
  rowIndex: number;

  @Column({ type: 'varchar' })
  cufe: string;

  @Column({ name: 'issuer_nit', type: 'varchar' })
  issuerNit: string;

  @Column({ name: 'issuer_name', type: 'varchar' })
  issuerName: string;

  @Column({
    type: 'varchar',
    default: PurchaseInvoiceImportRowStatus.PENDING,
  })
  status: PurchaseInvoiceImportRowStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  /** Id del ElectronicDocument creado para esta fila, una vez procesada con éxito. */
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  /** Fila original del Excel — persistida para poder reanudar el job (tras
   * un reinicio del servidor) o reintentar solo esta fila sin depender de
   * que el archivo original siga disponible en memoria. */
  @Column({ name: 'raw_row', type: 'jsonb', nullable: true })
  rawRow: DianSalesInvoiceRow | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  /** Cuándo un worker marcó esta fila 'processing' — si pasa
   * PURCHASE_INVOICE_PROCESSING_TIMEOUT_MINUTES sin resolverse (worker
   * caído a mitad de proceso), se considera abandonada y vuelve a
   * 'pending' (ver recoverAbandonedRows). */
  @Column({ name: 'processing_at', type: 'timestamptz', nullable: true })
  processingAt: Date | null;

  /** Cuántas veces un worker reclamó esta fila (no confundir con los
   * reintentos internos de NextPymeApiClient dentro de un mismo intento) —
   * sube en cada claimPendingBatch, útil para diagnosticar filas que se
   * abandonan repetidamente. */
  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => PurchaseInvoiceImportJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: PurchaseInvoiceImportJob;
}
