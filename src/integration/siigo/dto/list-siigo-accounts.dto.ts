import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListSiigoAccountsQueryDto {
  @ApiPropertyOptional({
    description:
      'ID de la empresa. Si no se envía, usa la primera empresa configurada.',
  })
  companyId?: string;
}

export class SiigoAccountCatalogItemDto {
  code: string;
  name: string;
}
