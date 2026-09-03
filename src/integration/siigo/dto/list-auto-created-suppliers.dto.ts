import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListAutoCreatedSuppliersQueryDto {
  @ApiPropertyOptional({
    description:
      'Fecha/hora ISO desde la cual buscar terceros creados automáticamente (ej. el momento en que se disparó el import). Por defecto, la última hora.',
  })
  since?: string;
}

export class AutoCreatedSupplierDto {
  supplierDocument: string;
  supplierName: string;
  createdAt: string;
}

export class ListAutoCreatedSuppliersResponseDto {
  suppliers: AutoCreatedSupplierDto[];
}
