import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { Integration } from '../../integration/entities/integration.entity';
import { IntegrationProvider } from '../../integration/enums/integration-provider.enum';
import type { PlanCommercialTerms } from '../plan-commercial-terms';

@Entity('plans')
export class Plan {
  @Column({ name: 'commission_class', type: 'varchar', length: 10, nullable: true })
  commissionClass: 'BASIC' | 'PLUS' | 'PRO' | null;
  @Column({ name: 'sale_price_cop', type: 'numeric', precision: 14, scale: 2, nullable: true })
  salePriceCop: string | null;
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  code: string;

  @Column({ type: 'varchar', length: 50 })
  provider: IntegrationProvider;

  @Column({ name: 'document_limit', type: 'integer', nullable: true })
  documentLimit: number | null;

  @Column({ name: 'commercial_terms', type: 'jsonb', nullable: true })
  commercialTerms: PlanCommercialTerms | null;

  @Column({
    name: 'included_document_types',
    type: 'jsonb',
    default: () => "'[]'",
  })
  includedDocumentTypes: ElectronicDocumentType[];

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Integration, (integration) => integration.plan)
  integrations: Integration[];
}
