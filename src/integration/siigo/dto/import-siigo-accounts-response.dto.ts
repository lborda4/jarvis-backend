import { ApiProperty } from '@nestjs/swagger';

export class ImportSiigoAccountsResponseDto {
  @ApiProperty({
    example: 320,
    description: 'Cuentas del archivo que cumplieron los filtros y se guardaron',
  })
  processedRows: number;

  @ApiProperty({ example: 300 })
  accountsCreated: number;

  @ApiProperty({ example: 20 })
  accountsUpdated: number;

  @ApiProperty({
    example: 1450,
    description:
      'Filas descartadas: de agrupación, inactivas, con vencimientos o de una clase que no se contabiliza',
  })
  skippedRows: number;
}
