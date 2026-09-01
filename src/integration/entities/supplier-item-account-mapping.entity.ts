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
import { Integration } from './integration.entity';

/**
 * Mapeo de cuenta PUC a nivel (proveedor + descripción de ítem normalizada)
 * — separado de SupplierConfiguration a propósito: esa tabla sigue siendo
 * "un registro por proveedor" para medio de pago/impuestos/tipo de ítem,
 * que no cambian de granularidad acá; solo la cuenta contable se resuelve
 * por ítem. SupplierConfiguration.preference/campoVariabilidad.cuentaPuc
 * sigue existiendo y actúa como fallback (marcado como sugerencia, nunca
 * aplicado en silencio) cuando una descripción es nueva para el proveedor.
 */
@Entity('supplier_item_account_mappings')
@Index(
  'IDX_supplier_item_account_mappings_key',
  [
    'companyId',
    'integrationId',
    'supplierDocumentType',
    'supplierDocument',
    'descriptionNormalized',
  ],
  { unique: true },
)
export class SupplierItemAccountMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ name: 'supplier_document_type', type: 'varchar', default: 'NIT' })
  supplierDocumentType: string;

  @Column({ name: 'supplier_document' })
  supplierDocument: string;

  /** Clave de lookup — ver normalizeItemDescription. */
  @Column({ name: 'description_normalized', type: 'text' })
  descriptionNormalized: string;

  /** Descripción tal como vino originalmente, para mostrar en la UI sin
   * tener que re-derivarla. */
  @Column({ name: 'description_original', type: 'text' })
  descriptionOriginal: string;

  @Column({ name: 'account_code', type: 'varchar' })
  accountCode: string;

  @Column({ name: 'account_name', type: 'varchar', nullable: true })
  accountName: string | null;

  /** Cuántas veces se aplicó esta regla (uso automático incluido, no solo
   * confirmación manual) — señal de qué tan confiable/usada es. */
  @Column({ name: 'confirmations_count', type: 'integer', default: 0 })
  confirmationsCount: number;

  @Column({ name: 'last_confirmed_at', type: 'timestamptz', nullable: true })
  lastConfirmedAt: Date | null;

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
