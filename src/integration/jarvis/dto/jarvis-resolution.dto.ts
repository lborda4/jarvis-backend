import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JarvisResolutionKind } from '../enums/jarvis-resolution-kind.enum';

export class ParseJarvisResolutionUploadDto {
  @ApiProperty({ type: 'string', format: 'binary' })
  file: unknown;
}

export class JarvisResolutionDto {
  @ApiProperty({ enum: JarvisResolutionKind })
  kind: JarvisResolutionKind;

  @ApiPropertyOptional({ example: '18760000001', nullable: true })
  formNumber?: string | null;

  @ApiPropertyOptional({ example: '902086460', nullable: true })
  nit?: string | null;

  @ApiPropertyOptional({ example: '6', nullable: true })
  checkDigit?: string | null;

  @ApiPropertyOptional({ example: 'JARVIS COLOMBIA S.A.S', nullable: true })
  businessName?: string | null;

  @ApiProperty({ example: 'DOCUMENTO SOPORTE' })
  documentTypeLabel: string;

  @ApiPropertyOptional({ example: '6', nullable: true })
  modalityCode?: string | null;

  @ApiProperty({ example: 'DSJ' })
  prefix: string;

  @ApiProperty({ example: 1 })
  fromNumber: number;

  @ApiProperty({ example: 10000 })
  toNumber: number;

  @ApiPropertyOptional({
    example: 42,
    nullable: true,
    description: 'Siguiente consecutivo a emitir',
  })
  nextConsecutive?: number | null;

  @ApiPropertyOptional({ example: 'AUTORIZACIÓN', nullable: true })
  requestType?: string | null;

  @ApiPropertyOptional({ example: '2026', nullable: true })
  year?: string | null;

  @ApiPropertyOptional({ example: '2026-08-05', nullable: true })
  authorizedAt?: string | null;

  @ApiPropertyOptional({
    example: 'f5c872ebe43572e30c3f5c872ebe43572e65738132efc1864d3c536',
    nullable: true,
  })
  technicalKey?: string | null;

  @ApiPropertyOptional({ example: '2026-08-05', nullable: true })
  dateFrom?: string | null;

  @ApiPropertyOptional({ example: '2027-08-05', nullable: true })
  dateTo?: string | null;

  @ApiPropertyOptional({ example: '2026-08-05T23:10:00.000Z', nullable: true })
  configuredAt?: string | null;
}

export class ParseJarvisResolutionResponseDto {
  @ApiProperty({ type: JarvisResolutionDto })
  resolution: JarvisResolutionDto;

  @ApiProperty({ type: [String] })
  warnings: string[];
}

export class SaveJarvisResolutionRequestDto {
  @ApiProperty({ enum: JarvisResolutionKind })
  kind: JarvisResolutionKind;

  @ApiProperty({ example: '18760000001' })
  formNumber: string;

  @ApiPropertyOptional({ example: '902086460' })
  nit?: string;

  @ApiPropertyOptional({ example: '6' })
  checkDigit?: string;

  @ApiPropertyOptional({ example: 'JARVIS COLOMBIA S.A.S' })
  businessName?: string;

  @ApiProperty({ example: 'DOCUMENTO SOPORTE' })
  documentTypeLabel: string;

  @ApiPropertyOptional({ example: '6' })
  modalityCode?: string;

  @ApiProperty({ example: 'DSJ' })
  prefix: string;

  @ApiProperty({ example: 1 })
  fromNumber: number;

  @ApiProperty({ example: 10000 })
  toNumber: number;

  @ApiPropertyOptional({ example: 'AUTORIZACIÓN' })
  requestType?: string;

  @ApiPropertyOptional({ example: '2026' })
  year?: string;

  @ApiPropertyOptional({ example: '2026-08-05' })
  authorizedAt?: string;

  @ApiProperty({
    example: 'f5c872ebe43572e30c3f5c872ebe43572e65738132efc1864d3c536',
  })
  technicalKey: string;

  @ApiProperty({ example: '2026-08-05' })
  dateFrom: string;

  @ApiProperty({ example: '2027-08-05' })
  dateTo: string;
}

export class SaveJarvisResolutionResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: JarvisResolutionDto })
  resolution: JarvisResolutionDto;
}
