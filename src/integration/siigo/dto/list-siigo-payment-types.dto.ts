import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListSiigoPaymentTypesQueryDto {
  @ApiPropertyOptional({
    description:
      'ID de la empresa. Si no se envía, usa la primera empresa configurada.',
  })
  companyId?: string;

  @ApiPropertyOptional({
    description:
      'Tipo de documento SIIGO para filtrar formas de pago. FC = factura de compra, DS = documento soporte.',
    default: 'FC',
    examples: ['FC', 'DS'],
  })
  documentType?: string;
}

export class SiigoPaymentTypeCatalogItemDto {
  id: number;
  name: string;
  type: string;
  dueDate: boolean;
  documentType: string;
}
