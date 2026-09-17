import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveElectronicDocumentDraftItemDto {
  @ApiProperty({ enum: ['Product', 'FixedAsset', 'Account'] })
  tipo: 'Product' | 'FixedAsset' | 'Account';

  @ApiProperty({ example: '51350501' })
  producto: string;

  @ApiProperty({ example: 'SERVICIO DE VIGILANCIA' })
  description: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ example: 169218 })
  unitValue: number;

  @ApiProperty({ example: 0 })
  discount: number;

  @ApiPropertyOptional({ example: 13, nullable: true })
  ivaTaxId?: number | null;

  @ApiPropertyOptional({ example: 21, nullable: true })
  retefuenteTaxId?: number | null;
}

export class SaveElectronicDocumentDraftRequestDto {
  @ApiPropertyOptional({ type: [SaveElectronicDocumentDraftItemDto] })
  items?: SaveElectronicDocumentDraftItemDto[];

  @ApiPropertyOptional({ example: '51350501', nullable: true })
  accountCode?: string | null;

  @ApiPropertyOptional({ example: 5636, nullable: true })
  paymentMethodId?: number | null;

  @ApiPropertyOptional({ example: '2026-10-02', nullable: true })
  dueDate?: string | null;

  @ApiPropertyOptional({ example: 'CUFE: ...', nullable: true })
  observations?: string | null;

  @ApiPropertyOptional({ type: [Number], example: [21, 30] })
  retentionTaxIds?: number[];

  @ApiPropertyOptional({ example: 0, nullable: true })
  documentDiscount?: number | null;
}

export class SaveElectronicDocumentDraftResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({
    example: 'PENDIENTE',
    description:
      'Estado del documento después de guardar: al completarse lo que faltaba deja de estar en revisión',
  })
  status: string;

  @ApiProperty({ example: '2026-09-09T20:15:00.000Z' })
  savedAt: string;
}
