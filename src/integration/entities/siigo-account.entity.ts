import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { Integration } from './integration.entity';

@Entity('siigo_accounts')
@Unique('UQ_siigo_accounts_company_integration_code', [
  'companyId',
  'integrationId',
  'code',
])
export class SiigoAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ name: 'is_transactional', type: 'boolean', default: false })
  isTransactional: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration: Integration;
}
