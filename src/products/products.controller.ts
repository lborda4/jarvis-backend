import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CreateProductCategoryRequestDto,
  ProductCategoriesListResponseDto,
  ProductCategoryDto,
  UpdateProductCategoryRequestDto,
} from './dto/product-category.dto';
import {
  CreateProductRequestDto,
  CreateProductResponseDto,
  ProductsListResponseDto,
} from './dto/product.dto';
import { ProductCategoriesService } from './product-categories.service';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly categoriesService: ProductCategoriesService,
  ) {}

  // ---- Categorías ----

  @Get('categories')
  @ApiOperation({ summary: 'Lista las categorías de producto de la empresa.' })
  listCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
  ): Promise<ProductCategoriesListResponseDto> {
    return this.categoriesService.list(getAuthenticatedCompanyId(user), search);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Crea una categoría de producto.' })
  createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateProductCategoryRequestDto,
  ): Promise<ProductCategoryDto> {
    return this.categoriesService.create(
      request.name,
      getAuthenticatedCompanyId(user),
    );
  }

  @Put('categories/:id')
  @ApiOperation({ summary: 'Actualiza el nombre de una categoría de producto.' })
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() request: UpdateProductCategoryRequestDto,
  ): Promise<ProductCategoryDto> {
    return this.categoriesService.update(
      id,
      request.name,
      getAuthenticatedCompanyId(user),
    );
  }

  // ---- Productos ----

  @Get()
  @ApiOperation({ summary: 'Lista los productos de la empresa.' })
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
  ): Promise<ProductsListResponseDto> {
    return this.productsService.list(getAuthenticatedCompanyId(user), search);
  }

  @Get('next-sku')
  @ApiOperation({
    summary: 'Sugiere el siguiente SKU según el tipo (producto o servicio).',
  })
  nextSku(
    @CurrentUser() user: AuthenticatedUser,
    @Query('kind') kind: string,
  ): Promise<{ sku: string }> {
    return this.productsService.nextSku(kind, getAuthenticatedCompanyId(user));
  }

  @Post()
  @ApiOperation({ summary: 'Crea un producto en la base de datos de Jarvis.' })
  createProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateProductRequestDto,
  ): Promise<CreateProductResponseDto> {
    return this.productsService.create(
      request,
      getAuthenticatedCompanyId(user),
    );
  }
}
