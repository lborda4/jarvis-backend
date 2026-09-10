import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductPriceList } from './entities/product-price-list.entity';
import { ProductCategoriesRepository } from './repositories/product-categories.repository';
import { ProductsRepository } from './repositories/products.repository';
import { ProductCategoriesService } from './product-categories.service';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, ProductCategory, ProductPriceList]),
  ],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductCategoriesService,
    ProductsRepository,
    ProductCategoriesRepository,
  ],
  exports: [ProductsService, ProductCategoriesService],
})
export class ProductsModule {}
