import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListSiigoTaxesQueryDto {
  @ApiPropertyOptional({
    description:
      'ID de la empresa. Si no se envía, usa la primera empresa configurada.',
  })
  companyId?: string;

  @ApiPropertyOptional({
    description:
      'Filtra por tipo de impuesto en SIIGO (por ejemplo, IVA, ReteIVA, ReteICA, Retefuente, Autorretención).',
    examples: ['IVA', 'ReteIVA', 'ReteICA', 'Retefuente'],
  })
  type?: string;
}

export class SiigoTaxCatalogItemDto {
  id: number;
  name: string;
  type: string;
  percentage: number;
  active: boolean;
}
