import { ApiProperty } from '@nestjs/swagger';
export class AdminAssignPackageDto {
  @ApiProperty({ minimum: 1, example: 100 }) documents: number;
}
