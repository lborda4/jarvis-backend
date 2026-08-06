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
    description: 'Consecutivos de documento disponibles',
    example: ['1001', 'DSJ1'],
  })
  siigoDocumentNumbers: string[];

  @ApiProperty({
    description: 'Estados de importación presentes en el historial',
    example: ['PENDIENTE', 'LISTA'],
  })
  importStatuses: string[];

  @ApiProperty({ type: [ElectronicDocumentSupplierFilterOptionDto] })
  suppliers: ElectronicDocumentSupplierFilterOptionDto[];
}
