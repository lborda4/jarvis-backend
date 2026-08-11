import { ApiPropertyOptional } from '@nestjs/swagger';

export class SaveSiigoDocumentTypesRequestDto {
  @ApiPropertyOptional({
    description: 'Id del comprobante SIIGO para Documento soporte (type=DS).',
    example: 24567,
  })
  supportDocumentTypeId?: number;

  @ApiPropertyOptional({
    description: 'Id del comprobante SIIGO para Factura de compra (type=FC).',
    example: 24568,
  })
  purchaseInvoiceTypeId?: number;
}

export class SaveSiigoDocumentTypesResponseDto {
  @ApiPropertyOptional({ nullable: true })
  supportDocumentTypeId: number | null;

  @ApiPropertyOptional({ nullable: true })
  purchaseInvoiceTypeId: number | null;

  @ApiPropertyOptional()
  documentTypesConfigured: boolean;
}
