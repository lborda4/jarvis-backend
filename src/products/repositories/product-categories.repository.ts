import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { ProductCategory } from '../entities/product-category.entity';

@Injectable()
export class ProductCategoriesRepository {
  constructor(
    @InjectRepository(ProductCategory)
    private readonly repository: Repository<ProductCategory>,
  ) {}

  findByCompany(
    companyId: string,
    search?: string,
  ): Promise<ProductCategory[]> {
    const trimmedSearch = search?.trim();

    if (!trimmedSearch) {
      return this.repository.find({
        where: { companyId },
        order: { name: 'ASC' },
      });
    }

    return this.repository.find({
      where: { companyId, name: ILike(`%${trimmedSearch}%`) },
      order: { name: 'ASC' },
    });
  }

  findByIdAndCompany(
    id: string,
    companyId: string,
  ): Promise<ProductCategory | null> {
    return this.repository.findOne({ where: { id, companyId } });
  }

  findByCompanyAndName(
    companyId: string,
    name: string,
  ): Promise<ProductCategory | null> {
    return this.repository.findOne({ where: { companyId, name } });
  }

  create(
    data: Pick<ProductCategory, 'companyId' | 'name'>,
  ): ProductCategory {
    return this.repository.create(data);
  }

  save(category: ProductCategory): Promise<ProductCategory> {
    return this.repository.save(category);
  }

  async remove(category: ProductCategory): Promise<void> {
    await this.repository.remove(category);
  }
}
