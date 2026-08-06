import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  RelationId,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { Plan } from '../../plan/entities/plan.entity';
import { SubscriptionStatus } from '../../plan/enums/subscription-status.enum';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import type { IntegrationCredentials } from '../interfaces/integration-credentials.interface';

@Entity('integrations')
@Index('UQ_integrations_company_provider', ['companyId', 'provider'], {
  unique: true,
})
export class Integration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 50 })
  provider: IntegrationProvider;

  @Column({ type: 'jsonb', default: {} })
  credentials: IntegrationCredentials;

  @ManyToOne(() => Plan, (plan) => plan.integrations, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan | null;

  @RelationId((integration: Integration) => integration.plan)
  planId: string | null;

  @Column({
    name: 'included_document_types',
    type: 'jsonb',
    default: () => "'[]'",
  })
  includedDocumentTypes: ElectronicDocumentType[];

  @Column({ name: 'subscription_started_at', type: 'timestamp', nullable: true })
  subscriptionStartedAt: Date | null;

  @Column({
    name: 'subscription_status',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  subscriptionStatus: SubscriptionStatus | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Company, (company) => company.integrations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
