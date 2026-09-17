import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductPriceListInputDto {
  @ApiProperty({ example: 1, description: 'Posición de la lista (1, 2 o 3).' })
  position: number;

  @ApiProperty({ example: 'Precio general' })
  name: string;

  @ApiProperty({ example: 50000 })
  price: number;

  @ApiProperty({ example: true })
  enabled: boolean;
}

export class CreateProductRequestDto {
  @ApiProperty({ example: 'PROD-001' })
  sku: string;

  @ApiProperty({ example: 'Camiseta básica' })
  name: string;

  @ApiProperty({ example: 'product', enum: ['product', 'service'] })
  kind: string;

  @ApiProperty({ example: '94', description: 'Código de unidad de medida DIAN.' })
  unit: string;

  @ApiPropertyOptional({ example: 'b3f1c2e4-...', nullable: true })
  categoryId?: string | null;

  @ApiPropertyOptional({ example: 'Camiseta básica en algodón.', nullable: true })
  description?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Ids de jarvis_taxes (Impuestos y retenciones) que aplican a este producto.',
  })
  taxIds?: string[];

  @ApiPropertyOptional({
    example: false,
    description: 'Si el precio de venta cargado ya incluye el IVA.',
  })
  priceIncludesIva?: boolean;

  @ApiProperty({ type: [ProductPriceListInputDto] })
  priceLists: ProductPriceListInputDto[];
}

export class ProductPriceListDto {
  @ApiProperty({ example: 'a1b2...' })
  id: string;

  @ApiProperty({ example: 1 })
  position: number;

  @ApiProperty({ example: 'Precio general' })
  name: string;

  @ApiProperty({ example: 50000 })
  price: number;

  @ApiProperty({ example: true })
  enabled: boolean;
}

export class ProductTaxDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  tax_type: string;

  @ApiPropertyOptional({ nullable: true })
  rate: number | null;
}

export class ProductDto {
  @ApiProperty({ example: 'b3f1...' })
  id: string;

  @ApiProperty({ example: 'PROD-001' })
  sku: string;

  @ApiProperty({ example: 'Camiseta básica' })
  name: string;

  @ApiProperty({ example: 'product' })
  kind: string;

  @ApiProperty({ example: '94' })
  unit: string;

  @ApiProperty({ example: 'b3f1...', nullable: true })
  categoryId: string | null;

  @ApiProperty({ example: 'Ropa', nullable: true })
  categoryName: string | null;

  @ApiProperty({ example: 'Camiseta básica en algodón.', nullable: true })
  description: string | null;

  @ApiProperty({ type: [ProductTaxDto] })
  taxes: ProductTaxDto[];

  @ApiProperty({ example: false })
  priceIncludesIva: boolean;

  @ApiProperty({ type: [ProductPriceListDto] })
  priceLists: ProductPriceListDto[];
}

export class CreateProductResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: ProductDto })
  product: ProductDto;
}

export class ProductsListResponseDto {
  @ApiProperty({ type: [ProductDto] })
  items: ProductDto[];

  @ApiProperty({ example: 12 })
  total: number;
}
