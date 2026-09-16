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

export class CreateSiigoSuppliersBulkItemDto {
  @ApiProperty({
    description:
      'document_id del proveedor seleccionado (ver GET suppliers/pending).',
  })
  documentId: string;

  @ApiPropertyOptional({
    description:
      'Nombre/razón social editado en el modal — si viene, sobrescribe el que trae el documento antes de crear el tercero en SIIGO (ver createSupplier).',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'Correo editado en el modal — mismo criterio que name.',
  })
  email?: string;
}

export class CreateSiigoSuppliersBulkRequestDto {
  @ApiProperty({ type: [CreateSiigoSuppliersBulkItemDto] })
  suppliers: CreateSiigoSuppliersBulkItemDto[];
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
