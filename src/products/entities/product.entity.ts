import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { JarvisTax } from '../../integration/jarvis/entities/jarvis-tax.entity';
import { ProductCategory } from './product-category.entity';
import { ProductPriceList } from './product-price-list.entity';

/**
 * Producto nativo de Jarvis. Vive en nuestra propia base de datos (no es una
 * copia de SIIGO ni de ninguna integración), por eso solo está scopeado por
 * `company_id`. El SKU es único dentro de la empresa, pero puede repetirse
 * entre empresas distintas, por eso el identificador real es el `id` (uuid).
 *
 * Los impuestos/retenciones del producto ya NO son un bloque fijo de columnas
 * (IVA/Retefuente/ReteICA/ReteIVA con su propia tarifa) — el producto
 * referencia directamente filas reales del catálogo de la empresa
 * (jarvis_taxes, ver Impuestos y retenciones), vía la tabla puente
 * `product_taxes`. Las listas de precios (varias por producto) van en la
 * tabla hija `product_price_lists`. Sin created_at/updated_at: no se lleva
 * trazabilidad.
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

  /** Si el precio de venta que se cargó ya trae el IVA incluido, o si es
   * antes de impuestos. Es del producto en general (no de un impuesto en
   * particular): un checkbox simple, no depende de qué tax_ids se elijan. */
  @Column({ name: 'price_includes_iva', type: 'boolean', default: false })
  priceIncludesIva: boolean;

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

  @ManyToMany(() => JarvisTax)
  @JoinTable({
    name: 'product_taxes',
    joinColumn: { name: 'product_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tax_id', referencedColumnName: 'id' },
  })
  taxes: JarvisTax[];
}
