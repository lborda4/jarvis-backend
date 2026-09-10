import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';

/**
 * Categoría de producto de una empresa. Es un catálogo interno para que cada
 * empresa organice sus productos, por eso solo está scopeada por `company_id`.
 * Sin created_at/updated_at: no se lleva trazabilidad de estos registros.
 */
@Entity('product_categories')
@Index('UQ_product_categories_company_name', ['companyId', 'name'], {
  unique: true,
})
export class ProductCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
