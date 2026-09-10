import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { ProductCategory } from './product-category.entity';
import { ProductPriceList } from './product-price-list.entity';

/**
 * Producto nativo de Jarvis. Vive en nuestra propia base de datos (no es una
 * copia de SIIGO ni de ninguna integración), por eso solo está scopeado por
 * `company_id`. El SKU es único dentro de la empresa, pero puede repetirse
 * entre empresas distintas, por eso el identificador real es el `id` (uuid).
 *
 * El bloque de IVA y retenciones se guarda como columnas planas: son campos
 * finitos y de cardinalidad 1 por producto. La regla "si `_enabled` es false,
 * ignora sus campos" vive en el service, por eso los campos dependientes son
 * nullable. Las listas de precios (varias por producto) van en la tabla hija
 * `product_price_lists`. Sin created_at/updated_at: no se lleva trazabilidad.
 */
@Entity('products')
@Index('UQ_products_company_sku', ['companyId', 'sku'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** 'product' | 'service' — validado en el service. */
  @Column({ type: 'varchar', length: 20 })
  kind: string;

  /** Código de unidad de medida DIAN (ej. '94'). */
  @Column({ type: 'varchar', length: 16 })
  unit: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // ---- IVA ----
  @Column({ name: 'apply_iva', type: 'boolean', default: false })
  applyIva: boolean;

  /** 'taxed' | 'exempt' | 'excluded' — validado en el service. */
  @Column({
    name: 'tax_classification',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  taxClassification: string | null;

  @Column({ name: 'iva_rate', type: 'numeric', precision: 5, scale: 2, nullable: true })
  ivaRate: string | null;

  @Column({ name: 'price_includes_iva', type: 'boolean', default: false })
  priceIncludesIva: boolean;

  // ---- Retención en la fuente ----
  @Column({ name: 'retefuente_enabled', type: 'boolean', default: false })
  retefuenteEnabled: boolean;

  @Column({ name: 'retefuente_concept', type: 'varchar', length: 100, nullable: true })
  retefuenteConcept: string | null;

  @Column({ name: 'retefuente_rate', type: 'numeric', precision: 5, scale: 2, nullable: true })
  retefuenteRate: string | null;

  @Column({ name: 'retefuente_min_base', type: 'numeric', precision: 14, scale: 2, nullable: true })
  retefuenteMinBase: string | null;

  // ---- ReteICA ----
  @Column({ name: 'reteica_enabled', type: 'boolean', default: false })
  reteicaEnabled: boolean;

  @Column({ name: 'reteica_municipality', type: 'varchar', length: 100, nullable: true })
  reteicaMunicipality: string | null;

  @Column({ name: 'reteica_rate', type: 'numeric', precision: 7, scale: 4, nullable: true })
  reteicaRate: string | null;

  @Column({ name: 'reteica_min_base', type: 'numeric', precision: 14, scale: 2, nullable: true })
  reteicaMinBase: string | null;

  // ---- ReteIVA ----
  @Column({ name: 'reteiva_enabled', type: 'boolean', default: false })
  reteivaEnabled: boolean;

  @Column({ name: 'reteiva_rate', type: 'numeric', precision: 5, scale: 2, nullable: true })
  reteivaRate: string | null;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => ProductCategory, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'category_id' })
  category: ProductCategory | null;

  @OneToMany(() => ProductPriceList, (priceList) => priceList.product, {
    cascade: true,
  })
  priceLists: ProductPriceList[];
}
