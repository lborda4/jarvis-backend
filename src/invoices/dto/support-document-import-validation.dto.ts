import { ApiProperty } from '@nestjs/swagger';

export class SupportDocumentValidationRowErrorDto {
  @ApiProperty()
  groupKey: string;

  @ApiProperty()
  reference: string;

  @ApiProperty()
  reason: string;
}

export class SupportDocumentValidationReportDto {
  @ApiProperty()
  totalGroups: number;

  @ApiProperty()
  validGroups: number;

  @ApiProperty()
  invalidGroups: number;

  @ApiProperty({ type: [SupportDocumentValidationRowErrorDto] })
  errors: SupportDocumentValidationRowErrorDto[];
}
