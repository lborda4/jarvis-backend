import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoiceImportJob } from '../entities/purchase-invoice-import-job.entity';
import { PurchaseInvoiceImportJobStatus } from '../enums/purchase-invoice-import-job-status.enum';

@Injectable()
export class PurchaseInvoiceImportJobsRepository {
  constructor(
    @InjectRepository(PurchaseInvoiceImportJob)
    private readonly repository: Repository<PurchaseInvoiceImportJob>,
  ) {}

  create(
    data: Pick<
      PurchaseInvoiceImportJob,
      'companyId' | 'fileName' | 'totalRows' | 'status'
    >,
  ): PurchaseInvoiceImportJob {
    return this.repository.create(data);
  }

  save(job: PurchaseInvoiceImportJob): Promise<PurchaseInvoiceImportJob> {
    return this.repository.save(job);
  }

  findById(id: string): Promise<PurchaseInvoiceImportJob | null> {
    return this.repository.findOne({ where: { id } });
  }

  findLatestByCompany(
    companyId: string,
  ): Promise<PurchaseInvoiceImportJob | null> {
    return this.repository.findOne({
      where: { companyId },
      order: { startedAt: 'DESC' },
    });
  }

  /** Busca, aplica el patch y guarda — evita duplicar ese find+assign+save
   * en cada lugar que necesita actualizar campos puntuales del job
   * (InvoicesService y PurchaseInvoiceImportWorkerService). No-op si el
   * job no existe.
   *
   * NO incluye itemsTotal/documentsCreated/documentsReused/documentIds/
   * records a propósito: esos son contadores que se ACUMULAN por lote, y
   * este find+assign+save no es atómico entre lotes concurrentes del mismo
   * job — usar applyBatchResults() para esos campos. */
  async patch(
    jobId: string,
    patch: Partial<
      Pick<
        PurchaseInvoiceImportJob,
        | 'status'
        | 'processedRows'
        | 'validationReport'
        | 'errorMessage'
        | 'completedAt'
      >
    >,
  ): Promise<void> {
    const job = await this.findById(jobId);

    if (!job) {
      return;
    }

    Object.assign(job, patch);
    await this.save(job);
  }

  /** Acumula el resultado de UN lote de filas en los contadores del job
   * (items_total, documents_created, documents_reused, document_ids,
   * records) con UPDATE atómico en SQL — NO usa patch() (find+assign+save)
   * porque ese read-modify-write en JS pierde actualizaciones cuando dos
   * lotes del MISMO job se procesan en paralelo (dos instancias del backend
   * corriendo el worker a la vez): cada una lee un `job` en memoria antes de
   * empezar su lote, calcula el nuevo total a partir de ESE snapshot, y la
   * que guarda última pisa el trabajo de la otra sin fallar ni loguear nada.
   * Caso real reportado: Excel de 46 facturas terminó mostrando "8 creados +
   * 11 reusados" en vez de 46 — las 46 SÍ se crearon (document_id real en
   * cada fila), pero dos lotes se pisaron al acumular el contador del job.
   * Con `documents_created = documents_created + $1` la suma la hace
   * Postgres sobre el valor actual de la fila, sin importar el orden ni el
   * solapamiento de los UPDATEs. */
  async applyBatchResults(
    jobId: string,
    delta: {
      itemsTotal: number;
      documentsCreated: number;
      documentsReused: number;
      documentIds: string[];
      records: unknown[];
    },
  ): Promise<void> {
    await this.repository.query(
      `UPDATE purchase_invoice_import_jobs
       SET items_total = COALESCE(items_total, 0) + $2,
           documents_created = COALESCE(documents_created, 0) + $3,
           documents_reused = COALESCE(documents_reused, 0) + $4,
           document_ids = COALESCE(document_ids, '[]'::jsonb) || $5::jsonb,
           records = COALESCE(records, '[]'::jsonb) || $6::jsonb
       WHERE id = $1`,
      [
        jobId,
        delta.itemsTotal,
        delta.documentsCreated,
        delta.documentsReused,
        JSON.stringify(delta.documentIds),
        JSON.stringify(delta.records),
      ],
    );
  }

  /** Jobs con trabajo pendiente de procesar — lo que el worker recorre en
   * cada tick para decidir a cuáles reclamarles un lote. 'pending' incluye
   * jobs recién creados que el worker todavía no tocó. */
  findPendingOrRunning(): Promise<PurchaseInvoiceImportJob[]> {
    return this.repository.find({
      where: [
        { status: PurchaseInvoiceImportJobStatus.PENDING },
        { status: PurchaseInvoiceImportJobStatus.RUNNING },
      ],
      order: { startedAt: 'ASC' },
    });
  }
}
