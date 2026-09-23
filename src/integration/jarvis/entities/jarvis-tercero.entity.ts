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
import { Company } from '../../../company/entities/company.entity';
import { Integration } from '../../entities/integration.entity';
import { JarvisEntityType } from '../enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';

@Entity('jarvis_terceros')
@Index('IDX_jarvis_terceros_company_document', [
  'companyId',
  'documentType',
  'documentNumber',
], {
  unique: true,
})
export class JarvisTercero {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ name: 'document_type', type: 'varchar', length: 16 })
  documentType: string;

  @Column({ name: 'document_number', type: 'varchar', length: 32 })
  documentNumber: string;

  @Column({ name: 'check_digit', type: 'varchar', length: 2, nullable: true })
  checkDigit: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    name: 'entity_type',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  entityType: JarvisEntityType | null;

  @Column({
    name: 'tax_regime',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  taxRegime: JarvisTaxRegime | null;

  /** Código de la tabla maestra de NextPyme `type_liabilities` (ej.
   * "R-99-PN", id 117) — no es el enum fijo de 5 valores que usa la
   * configuración de la empresa (JarvisTaxResponsibility), es el catálogo
   * completo que devuelve NextPyme. "R-99-PN" es el valor por defecto
   * (pedido explícito). */
  @Column({
    name: 'tax_responsibility',
    type: 'varchar',
    length: 16,
    default: 'R-99-PN',
  })
  taxResponsibility: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  /** Id de la tabla maestra de NextPyme `municipalities` (ej. 149 Bogotá). */
  @Column({
    name: 'municipality_id',
    type: 'int',
    nullable: true,
  })
  municipalityId: number | null;

  /** Id de la tabla maestra de NextPyme `type_regime` (ej. 2 = No
   * Responsable de IVA), pedido explícito como valor por defecto. */
  @Column({
    name: 'type_regime_id',
    type: 'int',
    nullable: true,
  })
  typeRegimeId: number | null;

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
