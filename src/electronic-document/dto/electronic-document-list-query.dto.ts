import { ApiPropertyOptional } from '@nestjs/swagger';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';

export class ElectronicDocumentListQueryDto {
  @ApiPropertyOptional({
    description: 'Filtra por tipo de documento electrónico',
    enum: ElectronicDocumentType,
    example: ElectronicDocumentType.PURCHASE_INVOICE,
  })
  electronicDocumentType?: ElectronicDocumentType;

  @ApiPropertyOptional({ description: 'Filtra por estado del documento' })
  status?: string;

  @ApiPropertyOptional({ description: 'Filtra por ID de empresa' })
  companyId?: string;

  @ApiPropertyOptional({
    description: 'Fecha inicial de creación (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Fecha final de creación (YYYY-MM-DD)',
    example: '2026-12-31',
  })
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Búsqueda por CUFE, número de factura, proveedor o NIT',
  })
  search?: string;

  @ApiPropertyOptional({ description: 'Número de página', example: '1' })
  page?: string;

  @ApiPropertyOptional({ description: 'Cantidad de registros por página', example: '50' })
  limit?: string;
}
