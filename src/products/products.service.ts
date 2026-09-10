import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Product } from './entities/product.entity';
import { ProductPriceList } from './entities/product-price-list.entity';
import { ProductsRepository } from './repositories/products.repository';
import { ProductCategoriesRepository } from './repositories/product-categories.repository';
import {
  CreateProductRequestDto,
  CreateProductResponseDto,
  ProductDto,
  ProductsListResponseDto,
} from './dto/product.dto';

const VALID_KINDS = new Set(['product', 'service']);
const VALID_TAX_CLASSIFICATIONS = new Set(['taxed', 'exempt', 'excluded']);

/** Prefijo del SKU sugerido según el tipo. */
const SKU_PREFIX_BY_KIND: Record<string, string> = {
  product: 'PROD-',
  service: 'SERV-',
};
const SKU_PADDING = 3;

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly categoriesRepository: ProductCategoriesRepository,
  ) {}

  async list(
    companyId: string,
    search?: string,
  ): Promise<ProductsListResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const items = await this.productsRepository.findByCompany(
      trimmedCompanyId,
      search,
    );

    return { items: items.map((item) => this.toDto(item)), total: items.length };
  }

  /**
   * Siguiente SKU sugerido para el tipo dado, tomando como base el mayor
   * consecutivo ya usado por la empresa con ese prefijo (PROD- / SERV-). Así
   * el formulario recuerda el último SKU y evita colisiones aunque el usuario
   * lo olvide. Es solo una sugerencia: el usuario puede editarlo.
   */
  async nextSku(kind: string, companyId: string): Promise<{ sku: string }> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const normalizedKind = kind?.trim();

    if (!normalizedKind || !VALID_KINDS.has(normalizedKind)) {
      throw new BadRequestException('El tipo debe ser "product" o "service".');
    }

    const prefix = SKU_PREFIX_BY_KIND[normalizedKind];
    const existingSkus =
      await this.productsRepository.findSkusByCompanyAndPrefix(
        trimmedCompanyId,
        prefix,
      );

    let maxConsecutive = 0;
    for (const sku of existingSkus) {
      const match = sku.slice(prefix.length).match(/^(\d+)$/);
      if (match) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > maxConsecutive) {
          maxConsecutive = value;
        }
      }
    }

    const next = String(maxConsecutive + 1).padStart(SKU_PADDING, '0');
    return { sku: `${prefix}${next}` };
  }

  async create(
    request: CreateProductRequestDto,
    companyId: string,
  ): Promise<CreateProductResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);

    const sku = request.sku?.trim();
    if (!sku) {
      throw new BadRequestException('El código / SKU es obligatorio.');
    }

    const name = request.name?.trim();
    if (!name) {
      throw new BadRequestException('El nombre del producto es obligatorio.');
    }

    const kind = request.kind?.trim();
    if (!kind || !VALID_KINDS.has(kind)) {
      throw new BadRequestException(
        'El tipo debe ser "product" o "service".',
      );
    }

    const unit = request.unit?.trim();
    if (!unit) {
      throw new BadRequestException('La unidad de medida DIAN es obligatoria.');
    }

    if (
      request.applyIva &&
      request.taxClassification &&
      !VALID_TAX_CLASSIFICATIONS.has(request.taxClassification.trim())
    ) {
      throw new BadRequestException(
        'La clasificación tributaria debe ser "taxed", "exempt" o "excluded".',
      );
    }

    // La categoría, si viene, debe existir y pertenecer a la misma empresa.
    const categoryId = request.categoryId?.trim() || null;
    if (categoryId) {
      const category = await this.categoriesRepository.findByIdAndCompany(
        categoryId,
        trimmedCompanyId,
      );
      if (!category) {
        throw new BadRequestException(
          'La categoría seleccionada no existe para esta empresa.',
        );
      }
    }

    const existing = await this.productsRepository.findByCompanyAndSku(
      trimmedCompanyId,
      sku,
    );
    if (existing) {
      throw new ConflictException('Ya existe un producto con ese código / SKU.');
    }

    const priceLists = this.buildPriceLists(request);

    const applyIva = Boolean(request.applyIva);

    const product = this.productsRepository.create({
      companyId: trimmedCompanyId,
      categoryId,
      sku,
      name,
      kind,
      unit,
      description: request.description?.trim() || null,
      applyIva,
      taxClassification: applyIva
        ? request.taxClassification?.trim() || null
        : null,
      ivaRate: applyIva ? this.toNumericString(request.ivaRate) : null,
      priceIncludesIva: Boolean(request.priceIncludesIva),
      retefuenteEnabled: Boolean(request.retefuenteEnabled),
      retefuenteConcept: request.retefuenteEnabled
        ? request.retefuenteConcept?.trim() || null
        : null,
      retefuenteRate: request.retefuenteEnabled
        ? this.toNumericString(request.retefuenteRate)
        : null,
      retefuenteMinBase: request.retefuenteEnabled
        ? this.toNumericString(request.retefuenteMinBase)
        : null,
      reteicaEnabled: Boolean(request.reteicaEnabled),
      reteicaMunicipality: request.reteicaEnabled
        ? request.reteicaMunicipality?.trim() || null
        : null,
      reteicaRate: request.reteicaEnabled
        ? this.toNumericString(request.reteicaRate)
        : null,
      reteicaMinBase: request.reteicaEnabled
        ? this.toNumericString(request.reteicaMinBase)
        : null,
      reteivaEnabled: Boolean(request.reteivaEnabled),
      reteivaRate: request.reteivaEnabled
        ? this.toNumericString(request.reteivaRate)
        : null,
      priceLists,
    });

    const saved = await this.productsRepository.save(product);
    const full =
      (await this.productsRepository.findByIdAndCompany(
        saved.id,
        trimmedCompanyId,
      )) ?? saved;

    return { success: true, product: this.toDto(full) };
  }

  private buildPriceLists(
    request: CreateProductRequestDto,
  ): ProductPriceList[] {
    const rawLists = Array.isArray(request.priceLists)
      ? request.priceLists
      : [];

    const enabledLists = rawLists.filter((list) => list.enabled);
    if (enabledLists.length === 0) {
      throw new BadRequestException(
        'Debes tener al menos una lista de precios activa.',
      );
    }

    const seenPositions = new Set<number>();

    return rawLists.map((list) => {
      const position = Number(list.position);
      if (!Number.isInteger(position) || position <= 0) {
        throw new BadRequestException(
          'Cada lista de precios debe tener una posición válida.',
        );
      }
      if (seenPositions.has(position)) {
        throw new BadRequestException(
          'Las listas de precios no pueden repetir posición.',
        );
      }
      seenPositions.add(position);

      const listName = list.name?.trim();
      if (list.enabled && !listName) {
        throw new BadRequestException(
          'El nombre de la lista de precios activa es obligatorio.',
        );
      }

      const price = Number(list.price);
      if (list.enabled && (!Number.isFinite(price) || price <= 0)) {
        throw new BadRequestException(
          'El precio de venta de una lista activa debe ser mayor a 0.',
        );
      }

      const priceList = new ProductPriceList();
      priceList.position = position;
      priceList.name = listName || `Lista ${position}`;
      priceList.price = this.toNumericString(price) ?? '0';
      priceList.enabled = Boolean(list.enabled);
      return priceList;
    });
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

  /** Convierte un número entrante a la representación string que TypeORM usa
   * para columnas numeric. Devuelve null si no hay un número válido. */
  private toNumericString(value: number | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return String(parsed);
  }

  private toNumber(value: string | null): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toDto(product: Product): ProductDto {
    const priceLists = [...(product.priceLists ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((list) => ({
        id: list.id,
        position: list.position,
        name: list.name,
        price: this.toNumber(list.price) ?? 0,
        enabled: list.enabled,
      }));

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      kind: product.kind,
      unit: product.unit,
      categoryId: product.categoryId,
      categoryName: product.category?.name ?? null,
      description: product.description,
      applyIva: product.applyIva,
      taxClassification: product.taxClassification,
      ivaRate: this.toNumber(product.ivaRate),
      priceIncludesIva: product.priceIncludesIva,
      retefuenteEnabled: product.retefuenteEnabled,
      retefuenteConcept: product.retefuenteConcept,
      retefuenteRate: this.toNumber(product.retefuenteRate),
      retefuenteMinBase: this.toNumber(product.retefuenteMinBase),
      reteicaEnabled: product.reteicaEnabled,
      reteicaMunicipality: product.reteicaMunicipality,
      reteicaRate: this.toNumber(product.reteicaRate),
      reteicaMinBase: this.toNumber(product.reteicaMinBase),
      reteivaEnabled: product.reteivaEnabled,
      reteivaRate: this.toNumber(product.reteivaRate),
      priceLists,
    };
  }
}
