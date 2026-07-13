import { ApiPropertyOptional } from '@nestjs/swagger';

export class ImportBalanceTrialRequestDto {
  @ApiPropertyOptional({
    description: 'Cuenta contable inicial del reporte SIIGO.',
    example: '11050501',
  })
  accountStart?: string;

  @ApiPropertyOptional({
    description: 'Cuenta contable final del reporte SIIGO.',
    example: '41350501',
  })
  accountEnd?: string;

  @ApiPropertyOptional({
    description: 'Año fiscal del reporte. Por defecto, el año actual.',
    example: 2026,
  })
  year?: number;

  @ApiPropertyOptional({
    description: 'Mes inicial del reporte (1-13). Por defecto, 1.',
    example: 1,
  })
  monthStart?: number;

  @ApiPropertyOptional({
    description: 'Mes final del reporte (1-13). Por defecto, 13.',
    example: 13,
  })
  monthEnd?: number;

  @ApiPropertyOptional({
    description: 'Incluir cuentas de diferencia fiscal.',
    example: false,
  })
  includesTaxDifference?: boolean;

  @ApiPropertyOptional({
    description: 'Filtrar por un tercero específico.',
  })
  customer?: string;
}

export class ImportBalanceTrialResponseDto {
  processedRows: number;
  suppliersCreated: number;
  suppliersUpdated: number;
  accountsAdded: number;
  duplicatedAccounts: number;
  fileId?: string;
  fileUrl?: string;
}
