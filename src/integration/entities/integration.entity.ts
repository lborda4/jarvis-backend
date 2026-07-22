import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
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
