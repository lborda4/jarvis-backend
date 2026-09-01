import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiigoPurchaseSyncJob } from '../entities/siigo-purchase-sync-job.entity';

@Injectable()
export class SiigoPurchaseSyncJobsRepository {
  constructor(
    @InjectRepository(SiigoPurchaseSyncJob)
    private readonly repository: Repository<SiigoPurchaseSyncJob>,
  ) {}

  create(
    data: Pick<SiigoPurchaseSyncJob, 'companyId' | 'integrationId'>,
  ): SiigoPurchaseSyncJob {
    return this.repository.create(data);
  }

  save(job: SiigoPurchaseSyncJob): Promise<SiigoPurchaseSyncJob> {
    return this.repository.save(job);
  }

  findById(id: string): Promise<SiigoPurchaseSyncJob | null> {
    return this.repository.findOne({ where: { id } });
  }

  findLatestByCompany(
    companyId: string,
    integrationId: string,
  ): Promise<SiigoPurchaseSyncJob | null> {
    return this.repository.findOne({
      where: { companyId, integrationId },
      order: { startedAt: 'DESC' },
    });
  }
}
