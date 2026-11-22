import { ApiProperty } from '@nestjs/swagger';

export class UpdateAdminPlanRequestDto {
  commissionClass?: 'BASIC' | 'PLUS' | 'PRO' | null;
  salePriceCop?: number | null;
  @ApiProperty({ maxLength: 255 })
  name: string;

  @ApiProperty({ nullable: true, minimum: 1, maximum: 2147483647, description: 'Cupo de documentos; null para un plan sin limite.' })
  documentLimit: number | null;
}
