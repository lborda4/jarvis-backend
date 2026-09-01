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
   * job no existe. */
  async patch(
    jobId: string,
    patch: Partial<
      Pick<
        PurchaseInvoiceImportJob,
        | 'status'
        | 'processedRows'
        | 'itemsTotal'
        | 'documentsCreated'
        | 'documentIds'
        | 'records'
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
