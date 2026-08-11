import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
  SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
} from '../constants/siigo.constants';

export class ListSiigoDocumentTypesQueryDto {
  @ApiProperty({
    description: 'Tipo de comprobante SIIGO a consultar.',
    enum: [
      SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
      SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
    ],
    example: SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
  })
  type:
    | typeof SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY
    | typeof SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY;
}

export class SiigoDocumentTypeCatalogItemDto {
  @ApiProperty()
  id: number;

  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  type?: string;

  @ApiPropertyOptional()
  active?: boolean;
}
