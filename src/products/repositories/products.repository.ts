import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { ProductPriceList } from '../entities/product-price-list.entity';

@Injectable()
export class ProductsRepository {
  constructor(
    @InjectRepository(Product)
    private readonly repository: Repository<Product>,
  ) {}

  findByCompany(companyId: string, search?: string): Promise<Product[]> {
    const trimmedSearch = search?.trim();

    if (!trimmedSearch) {
      return this.repository.find({
        where: { companyId },
        relations: { priceLists: true, category: true, taxes: true },
        order: { name: 'ASC' },
      });
    }

    return this.repository.find({
      where: [
        { companyId, name: ILike(`%${trimmedSearch}%`) },
        { companyId, sku: ILike(`%${trimmedSearch}%`) },
      ],
      relations: { priceLists: true, category: true, taxes: true },
      order: { name: 'ASC' },
    });
  }

  findByIdAndCompany(id: string, companyId: string): Promise<Product | null> {
    return this.repository.findOne({
      where: { id, companyId },
      relations: { priceLists: true, category: true, taxes: true },
    });
  }

  findByCompanyAndSku(
    companyId: string,
    sku: string,
  ): Promise<Product | null> {
    return this.repository.findOne({ where: { companyId, sku } });
  }

  /** SKUs de la empresa que empiezan con un prefijo (ej. "PROD-"). Se usa para
   * calcular el siguiente consecutivo sugerido en el formulario. */
  async findSkusByCompanyAndPrefix(
    companyId: string,
    prefix: string,
  ): Promise<string[]> {
    const rows = await this.repository.find({
      where: { companyId, sku: ILike(`${prefix}%`) },
      select: { sku: true },
    });
    return rows.map((row) => row.sku);
  }

  create(data: Partial<Product>): Product {
    return this.repository.create(data);
  }

  replace(product: Product): Promise<Product> {
    return this.repository.manager.transaction(async (manager) => {
      const target = await manager.findOne(Product, {
        where: { id: product.id, companyId: product.companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!target) throw new NotFoundException('El producto no existe para esta empresa.');
      // Reemplaza las listas dentro de la misma transaccion, sin dejar precios antiguos.
      await manager.delete(ProductPriceList, { productId: product.id });
      return manager.save(Product, product);
    });
  }

  deleteByIdAndCompany(id: string, companyId: string) {
    return this.repository.delete({ id, companyId });
  }

  save(product: Product): Promise<Product> {
    return this.repository.save(product);
  }
}
