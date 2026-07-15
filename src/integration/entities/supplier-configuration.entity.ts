import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import type { SupplierMappingValue } from '../interfaces/supplier-mapping-value.interface';
import type { SupplierPreferenceSnapshot } from '../interfaces/supplier-preference.interface';
import { Integration } from './integration.entity';

@Entity('supplier_configurations')
export class SupplierConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ name: 'supplier_document' })
  supplierDocument: string;

  @Column({ name: 'supplier_document_type', type: 'varchar', default: 'NIT' })
  supplierDocumentType: string;

  @Column({ name: 'supplier_name', type: 'varchar', nullable: true })
  supplierName: string | null;

  @Column({ name: 'item_type' })
  itemType: string;

  @Column({ name: 'mapping_value', type: 'jsonb', nullable: true })
  mappingValue: SupplierMappingValue | null;

  @Column({ type: 'jsonb', nullable: true })
  preference: SupplierPreferenceSnapshot | null;

  @Column({ name: 'auto_apply', default: false })
  autoApply: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Company, (company) => company.supplierConfigurations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration: Integration;
}
