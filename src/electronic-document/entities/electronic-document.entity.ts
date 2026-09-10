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
import type { ElectronicDocumentDraft } from '../interfaces/electronic-document-draft.interface';
import type { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

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

  @Column({ name: 'siigo_document_number', type: 'varchar', length: 64, nullable: true })
  siigoDocumentNumber: string | null;

  @Column({ name: 'supplier_exists_in_siigo', type: 'boolean', nullable: true })
  supplierExistsInSiigo: boolean | null;

  /** true si el documento se creó directo en PURCHASE_CREATED porque ya
   * existía en SIIGO al importar el Excel (match por provider_invoice, ver
   * ElectronicDocumentService.createFromPurchaseInvoiceRows) — a diferencia
   * de una factura que SÍ se envió desde Jarvis y SIIGO confirmó, que
   * también queda en PURCHASE_CREATED pero con este campo en false. Solo
   * distingue cómo mostrarlo (frontend: "Existente en SIIGO" vs "Lista");
   * el resto de la lógica (no reenviar, contar cupo, poder eliminarla
   * localmente, etc.) sigue tratando ambos casos igual, por eso NO es un
   * `status` aparte. */
  @Column({ name: 'already_in_siigo', type: 'boolean', default: false })
  alreadyInSiigo: boolean;

  @Column({ type: 'jsonb' })
  payload: ElectronicDocumentPayload;

  /** Ajustes del contador todavía sin enviar (ver ElectronicDocumentDraft).
   * Null mientras no haya guardado nada: el documento se contabiliza con lo
   * sugerido por historial/IA. */
  @Column({ type: 'jsonb', nullable: true })
  draft: ElectronicDocumentDraft | null;

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
