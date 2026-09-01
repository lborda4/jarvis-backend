import { Injectable, Logger } from '@nestjs/common';
import { SiigoProductCatalogItemDto } from './dto/list-siigo-products.dto';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SIIGO_PRODUCTS_CACHE_TTL_MS } from './constants/siigo-configuration-cache.constants';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { SiigoAuthService } from './siigo-auth.service';
import { mapWithConcurrency } from '../../common/helpers/concurrency.helper';
import { SiigoProduct } from './interfaces/siigo-api.interface';

interface ProductsMemoryCacheEntry {
  fetchedAt: number;
  items: SiigoProductCatalogItemDto[];
}

const PRODUCTS_PAGE_SIZE = 100;
/** Tope de seguridad: nunca deberíamos acercarnos a esto con page_size=100. */
const PRODUCTS_MAX_PAGES = 500;
const PRODUCTS_PAGE_FETCH_CONCURRENCY = 5;

@Injectable()
export class SiigoProductsCatalogService {
  private readonly logger = new Logger(SiigoProductsCatalogService.name);
  private readonly memoryCacheByCompany = new Map<
    string,
    ProductsMemoryCacheEntry
  >();

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
  ) {}

  async listProducts(companyId: string): Promise<SiigoProductCatalogItemDto[]> {
    const cached = this.memoryCacheByCompany.get(companyId);

    if (cached && Date.now() - cached.fetchedAt < SIIGO_PRODUCTS_CACHE_TTL_MS) {
      return cached.items;
    }

    const items = await this.fetchProductsFromSiigo(companyId);

    this.memoryCacheByCompany.set(companyId, {
      fetchedAt: Date.now(),
      items,
    });

    return items;
  }

  private async fetchPage(companyId: string, page: number) {
    return executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar productos',
      (accessToken, partnerId) =>
        this.siigoHttpClient.listProducts(
          accessToken,
          page,
          PRODUCTS_PAGE_SIZE,
          partnerId,
        ),
    );
  }

  private async fetchProductsFromSiigo(
    companyId: string,
  ): Promise<SiigoProductCatalogItemDto[]> {
    const firstPage = await this.fetchPage(companyId, 1);
    const totalResults = firstPage.pagination?.total_results ?? 0;
    const totalPages = Math.min(
      PRODUCTS_MAX_PAGES,
      Math.max(1, Math.ceil(totalResults / PRODUCTS_PAGE_SIZE)),
    );

    const allProducts: SiigoProduct[] = [...(firstPage.results ?? [])];

    if (totalPages > 1) {
      const remainingPages = Array.from(
        { length: totalPages - 1 },
        (_, index) => index + 2,
      );

      const pageResults = await mapWithConcurrency(
        remainingPages,
        PRODUCTS_PAGE_FETCH_CONCURRENCY,
        async (page) => {
          const response = await this.fetchPage(companyId, page);
          return response.results ?? [];
        },
      );

      for (const results of pageResults) {
        allProducts.push(...results);
      }
    }

    return allProducts
      .filter((product) => product.active !== false)
      .map((product) => ({
        code: product.code?.trim() || String(product.id),
        name: product.name?.trim() || `Producto ${product.id}`,
      }))
      .sort((left, right) =>
        left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }),
      );
  }
}
