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
import { SiigoPurchaseSyncJobStatus } from '../enums/siigo-purchase-sync-job-status.enum';
import { Integration } from './integration.entity';

@Entity('siigo_purchase_sync_jobs')
@Index('IDX_siigo_purchase_sync_jobs_company', [
  'companyId',
  'integrationId',
  'startedAt',
])
export class SiigoPurchaseSyncJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ type: 'varchar', default: SiigoPurchaseSyncJobStatus.RUNNING })
  status: SiigoPurchaseSyncJobStatus;

  @Column({ name: 'synced_count', type: 'integer', default: 0 })
  syncedCount: number;

  @Column({ name: 'total_count', type: 'integer', nullable: true })
  totalCount: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration: Integration;
}
