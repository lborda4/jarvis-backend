import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductCategory } from './entities/product-category.entity';
import { ProductCategoriesRepository } from './repositories/product-categories.repository';
import {
  ProductCategoriesListResponseDto,
  ProductCategoryDto,
} from './dto/product-category.dto';

@Injectable()
export class ProductCategoriesService {
  constructor(
    private readonly categoriesRepository: ProductCategoriesRepository,
  ) {}

  async list(
    companyId: string,
    search?: string,
  ): Promise<ProductCategoriesListResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const items = await this.categoriesRepository.findByCompany(
      trimmedCompanyId,
      search,
    );

    return { items: items.map((item) => this.toDto(item)), total: items.length };
  }

  async create(
    name: string,
    companyId: string,
  ): Promise<ProductCategoryDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const normalizedName = this.requireName(name);

    await this.ensureNameAvailable(trimmedCompanyId, normalizedName);

    const category = await this.categoriesRepository.save(
      this.categoriesRepository.create({
        companyId: trimmedCompanyId,
        name: normalizedName,
      }),
    );

    return this.toDto(category);
  }

  async update(
    id: string,
    name: string,
    companyId: string,
  ): Promise<ProductCategoryDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const normalizedName = this.requireName(name);

    const category = await this.requireCategory(id, trimmedCompanyId);

    if (category.name !== normalizedName) {
      await this.ensureNameAvailable(trimmedCompanyId, normalizedName);
      category.name = normalizedName;
      await this.categoriesRepository.save(category);
    }

    return this.toDto(category);
  }

  private requireCompanyId(companyId: string): string {
    const trimmed = companyId?.trim();
    if (!trimmed) {
      throw new BadRequestException(
        'El token no contiene una empresa activa válida.',
      );
    }
    return trimmed;
  }

  private requireName(name: string): string {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('El nombre de la categoría es obligatorio.');
    }
    return trimmed;
  }

  private async requireCategory(
    id: string,
    companyId: string,
  ): Promise<ProductCategory> {
    const category = await this.categoriesRepository.findByIdAndCompany(
      id,
      companyId,
    );
    if (!category) {
      throw new NotFoundException('La categoría no existe.');
    }
    return category;
  }

  private async ensureNameAvailable(
    companyId: string,
    name: string,
  ): Promise<void> {
    const existing = await this.categoriesRepository.findByCompanyAndName(
      companyId,
      name,
    );
    if (existing) {
      throw new ConflictException('Ya existe una categoría con ese nombre.');
    }
  }

  private toDto(category: ProductCategory): ProductCategoryDto {
    return { id: category.id, name: category.name };
  }
}
