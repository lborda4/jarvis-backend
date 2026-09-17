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
import { JarvisTaxCategory } from '../enums/jarvis-tax-category.enum';

@Entity('jarvis_taxes')
@Index('IDX_jarvis_taxes_company_code', ['companyId', 'code'], {
  unique: true,
})
export class JarvisTax {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ type: 'varchar', length: 32 })
  category: JarvisTaxCategory;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** "Tipo de impuesto" del formulario — texto libre con sugerencias en el
   * front (IVA, Retefuente, ReteICA, ReteIVA, Imconsumo...), no un enum: el
   * usuario puede escribir uno propio (ver decisión del pedido original). */
  @Column({ name: 'tax_type', type: 'varchar', length: 128 })
  taxType: string;

  /** Tarifa (%). Nullable: un impuesto puede no tener tarifa definida
   * todavía, y ReteICA nunca la lleva (se divide en mil por defecto, ver
   * isReteIca en jarvis-taxes.service.ts). */
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  rate: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** "En uso" — informativo, no lo edita el usuario directamente (ver
   * decisión del pedido original): por ahora nada más en el sistema
   * consume este catálogo, así que queda en false hasta que algo lo
   * referencie de verdad. */
  @Column({ name: 'is_in_use', type: 'boolean', default: false })
  isInUse: boolean;

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
