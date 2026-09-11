import { ApiProperty } from '@nestjs/swagger';

export class UnitMeasureDto {
  @ApiProperty({ example: '94', description: 'Código DIAN de la unidad.' })
  code: string;

  @ApiProperty({ example: 'Unidad', description: 'Nombre de la unidad.' })
  name: string;
}

export class UnitMeasuresListResponseDto {
  @ApiProperty({ type: [UnitMeasureDto] })
  items: UnitMeasureDto[];

  @ApiProperty({ example: 1093 })
  total: number;
}
