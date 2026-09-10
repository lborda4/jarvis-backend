import { ApiProperty } from '@nestjs/swagger';

export class CreateProductCategoryRequestDto {
  @ApiProperty({ example: 'Ropa' })
  name: string;
}

export class UpdateProductCategoryRequestDto {
  @ApiProperty({ example: 'Vestuario' })
  name: string;
}

export class ProductCategoryDto {
  @ApiProperty({ example: 'b3f1c2e4-5a6b-7c8d-9e0f-1a2b3c4d5e6f' })
  id: string;

  @ApiProperty({ example: 'Ropa' })
  name: string;
}

export class ProductCategoriesListResponseDto {
  @ApiProperty({ type: [ProductCategoryDto] })
  items: ProductCategoryDto[];

  @ApiProperty({ example: 8 })
  total: number;
}
