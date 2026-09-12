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
import { JarvisClientType } from '../enums/jarvis-client-type.enum';
import { JarvisEntityType } from '../enums/jarvis-entity-type.enum';
import { JarvisFiscalRegime } from '../enums/jarvis-fiscal-regime.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';
import { JarvisVatRegime } from '../enums/jarvis-vat-regime.enum';

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

  /** Régimen fiscal (ordinario/simple/especial) — validado en el service. */
  @Column({
    name: 'fiscal_regime',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  fiscalRegime: JarvisFiscalRegime | null;

  /** Responsabilidad de IVA (responsable / no responsable). */
  @Column({
    name: 'vat_regime',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  vatRegime: JarvisVatRegime | null;

  /** Actividad económica principal (CIIU) — texto libre por ahora. */
  @Column({
    name: 'economic_activity',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  economicActivity: string | null;

  /** País del tercero (nombre). */
  @Column({ type: 'varchar', length: 128, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  /** Ciudad/municipio del tercero (nombre), elegida del catálogo de NextPyme. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  city: string | null;

  /** Código DANE del municipio (ej. "11001"), del catálogo de NextPyme. */
  @Column({ name: 'city_code', type: 'varchar', length: 16, nullable: true })
  cityCode: string | null;

  /** 'client' | 'supplier' — validado en el service. */
  @Column({
    name: 'client_type',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  clientType: JarvisClientType | null;

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
