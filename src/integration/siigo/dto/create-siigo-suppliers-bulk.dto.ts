import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PendingSiigoSupplierDto {
  @ApiProperty({
    description:
      'Id de un documento electrónico pendiente de este proveedor — se usa para crear el tercero en SIIGO desde su payload.',
  })
  document_id: string;

  @ApiProperty()
  document_type: string;

  @ApiProperty({ example: '900123456' })
  document_number: string;

  @ApiPropertyOptional({ nullable: true })
  name: string | null;

  @ApiPropertyOptional({ nullable: true })
  email: string | null;
}

export class ListPendingSiigoSuppliersResponseDto {
  @ApiProperty({ type: [PendingSiigoSupplierDto] })
  items: PendingSiigoSupplierDto[];
}

export class CreateSiigoSuppliersBulkRequestDto {
  @ApiProperty({
    type: [String],
    description:
      'document_id de cada proveedor seleccionado (ver GET suppliers/pending).',
  })
  documentIds: string[];
}

export class CreateSiigoSuppliersBulkResultItemDto {
  @ApiProperty()
  documentId: string;

  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null;
}

export class CreateSiigoSuppliersBulkResponseDto {
  @ApiProperty()
  created: number;

  @ApiProperty({ description: 'Fallaron al crear en SIIGO (no bloquea el resto del lote).' })
  failed: number;

  @ApiProperty({ type: [CreateSiigoSuppliersBulkResultItemDto] })
  results: CreateSiigoSuppliersBulkResultItemDto[];
}
