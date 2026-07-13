import { ApiProperty } from '@nestjs/swagger';

export class PrepareSiigoDocumentsRequestDto {
  @ApiProperty({
    type: [String],
    description: 'IDs de documentos electrónicos a preparar en SIIGO.',
  })
  documentIds: string[];
}

export class PrepareSiigoDocumentsResponseDto {
  @ApiProperty()
  accepted: number;

  @ApiProperty()
  message: string;
}
