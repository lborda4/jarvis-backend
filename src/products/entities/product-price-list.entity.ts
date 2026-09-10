import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';

/**
 * Lista de precios de un producto (tabla hija, uno-a-muchos con products). El
 * formulario maneja tres listas fijas; `position` (1, 2, 3) identifica cuál es
 * y conserva el orden. Las listas desactivadas se guardan igual con
 * `enabled = false` para no perder el nombre/precio que el usuario ya escribió.
 * Sin created_at/updated_at: no se lleva trazabilidad.
 */
@Entity('product_price_lists')
@Index('UQ_product_price_lists_product_position', ['productId', 'position'], {
  unique: true,
})
export class ProductPriceList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'smallint' })
  position: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  price: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @ManyToOne(() => Product, (product) => product.priceLists, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
