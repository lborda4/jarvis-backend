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

  // ---- IVA ----
  @ApiProperty({ example: true })
  applyIva: boolean;

  @ApiPropertyOptional({
    example: 'taxed',
    enum: ['taxed', 'exempt', 'excluded'],
    nullable: true,
  })
  taxClassification?: string | null;

  @ApiPropertyOptional({ example: 19, nullable: true })
  ivaRate?: number | null;

  @ApiProperty({ example: true })
  priceIncludesIva: boolean;

  // ---- Retefuente ----
  @ApiProperty({ example: false })
  retefuenteEnabled: boolean;

  @ApiPropertyOptional({ example: 'Compras', nullable: true })
  retefuenteConcept?: string | null;

  @ApiPropertyOptional({ example: 2.5, nullable: true })
  retefuenteRate?: number | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  retefuenteMinBase?: number | null;

  // ---- ReteICA ----
  @ApiProperty({ example: false })
  reteicaEnabled: boolean;

  @ApiPropertyOptional({ example: 'Bogotá D.C.', nullable: true })
  reteicaMunicipality?: string | null;

  @ApiPropertyOptional({ example: 9.66, nullable: true })
  reteicaRate?: number | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  reteicaMinBase?: number | null;

  // ---- ReteIVA ----
  @ApiProperty({ example: false })
  reteivaEnabled: boolean;

  @ApiPropertyOptional({ example: 15, nullable: true })
  reteivaRate?: number | null;

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

  @ApiProperty({ example: true })
  applyIva: boolean;

  @ApiProperty({ example: 'taxed', nullable: true })
  taxClassification: string | null;

  @ApiProperty({ example: 19, nullable: true })
  ivaRate: number | null;

  @ApiProperty({ example: true })
  priceIncludesIva: boolean;

  @ApiProperty({ example: false })
  retefuenteEnabled: boolean;

  @ApiProperty({ example: 'Compras', nullable: true })
  retefuenteConcept: string | null;

  @ApiProperty({ example: 2.5, nullable: true })
  retefuenteRate: number | null;

  @ApiProperty({ example: 0, nullable: true })
  retefuenteMinBase: number | null;

  @ApiProperty({ example: false })
  reteicaEnabled: boolean;

  @ApiProperty({ example: 'Bogotá D.C.', nullable: true })
  reteicaMunicipality: string | null;

  @ApiProperty({ example: 9.66, nullable: true })
  reteicaRate: number | null;

  @ApiProperty({ example: 0, nullable: true })
  reteicaMinBase: number | null;

  @ApiProperty({ example: false })
  reteivaEnabled: boolean;

  @ApiProperty({ example: 15, nullable: true })
  reteivaRate: number | null;

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
