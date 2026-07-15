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
import { ElectronicDocumentStatus } from '../enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';
import { ElectronicDocumentProcessingStatus } from '../enums/electronic-document-processing-status.enum';
import type { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';
import type { RecommendedAccount } from '../interfaces/recommended-account.interface';

@Entity('electronic_documents')
export class ElectronicDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', nullable: true })
  cufe: string | null;

  @Column({ name: 'document_number_third', type: 'varchar', nullable: true })
  documentNumberThird: string | null;

  @Column({ name: 'document_type_third', type: 'varchar', nullable: true })
  documentTypeThird: string | null;

  @Column({ type: 'varchar', length: 50 })
  status: ElectronicDocumentStatus;

  @Column({
    name: 'electronic_document_type',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  electronicDocumentType: ElectronicDocumentType | null;

  @Column({ name: 'siigo_purchase_id', type: 'varchar', nullable: true })
  siigoPurchaseId: string | null;

  @Column({ name: 'siigo_document_number', type: 'integer', nullable: true })
  siigoDocumentNumber: number | null;

  @Column({ name: 'supplier_exists_in_siigo', type: 'boolean', nullable: true })
  supplierExistsInSiigo: boolean | null;

  @Column({ name: 'recommended_account', type: 'jsonb', nullable: true })
  recommendedAccount: RecommendedAccount | null;

  @Column({
    name: 'processing_status',
    type: 'varchar',
    length: 50,
    default: ElectronicDocumentProcessingStatus.PENDING,
  })
  processingStatus: ElectronicDocumentProcessingStatus;

  @Column({ type: 'jsonb' })
  payload: ElectronicDocumentPayload;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Company, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
