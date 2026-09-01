import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { PurchaseInvoiceImportJobStatus } from '../enums/purchase-invoice-import-job-status.enum';
import { PurchaseInvoiceImportRecord } from '../interfaces/purchase-invoice-import-result.interface';
import { PurchaseInvoiceValidationReport } from '../helpers/purchase-invoice-import-validation.helper';

/**
 * Job de importación de Factura de compra por Excel: el parseo del archivo
 * es rápido (en memoria), pero consultar el CUFE de cada fila en NextPyme no
 * lo es — con 500+ filas puede tardar minutos y superar cualquier timeout de
 * cliente HTTP. La importación corre en segundo plano (ver
 * InvoicesService.runPurchaseInvoiceImport) y el frontend consulta el
 * progreso acá en vez de esperar la respuesta del POST original.
 */
@Entity('purchase_invoice_import_jobs')
@Index('IDX_purchase_invoice_import_jobs_company', ['companyId', 'startedAt'])
export class PurchaseInvoiceImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({
    type: 'varchar',
    default: PurchaseInvoiceImportJobStatus.PENDING,
  })
  status: PurchaseInvoiceImportJobStatus;

  @Column({ name: 'file_name', type: 'varchar', nullable: true })
  fileName: string | null;

  @Column({ name: 'processed_rows', type: 'integer', default: 0 })
  processedRows: number;

  @Column({ name: 'total_rows', type: 'integer', nullable: true })
  totalRows: number | null;

  @Column({ name: 'items_total', type: 'integer', nullable: true })
  itemsTotal: number | null;

  @Column({ name: 'documents_created', type: 'integer', nullable: true })
  documentsCreated: number | null;

  @Column({ name: 'document_ids', type: 'jsonb', nullable: true })
  documentIds: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  records: PurchaseInvoiceImportRecord[] | null;

  /** Reporte completo de la pasada de validación previa, solo se llena si el
   * job terminó en error PORQUE la validación encontró filas inválidas (ver
   * InvoicesService.runPurchaseInvoiceImport) — el detalle fila-a-fila del
   * procesamiento real vive en PurchaseInvoiceImportJobRow, no acá. */
  @Column({ name: 'validation_report', type: 'jsonb', nullable: true })
  validationReport: PurchaseInvoiceValidationReport | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
