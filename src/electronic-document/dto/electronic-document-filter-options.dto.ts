import { ApiProperty } from '@nestjs/swagger';

export class ElectronicDocumentSupplierFilterOptionDto {
  @ApiProperty({ example: '900123456' })
  nit: string;

  @ApiProperty({ example: 'Proveedor Ejemplo S.A.S.' })
  name: string;
}

export class ElectronicDocumentFilterOptionsDto {
  @ApiProperty({
    description: 'Fechas de emisión disponibles (YYYY-MM-DD)',
    example: ['2026-03-01', '2026-03-02'],
  })
  issueDates: string[];

  @ApiProperty({
    description: 'Consecutivos SIIGO disponibles',
    example: [1001, 1002],
  })
  siigoDocumentNumbers: number[];

  @ApiProperty({
    description: 'Estados de importación presentes en el historial',
    example: ['PENDIENTE', 'LISTA'],
  })
  importStatuses: string[];

  @ApiProperty({ type: [ElectronicDocumentSupplierFilterOptionDto] })
  suppliers: ElectronicDocumentSupplierFilterOptionDto[];
}
