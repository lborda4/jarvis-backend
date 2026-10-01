import { ApiProperty } from '@nestjs/swagger';

export class SaveJarvisPaymentMethodDto {
  @ApiProperty({ example: 'Transferencia Bancolombia', maxLength: 120 }) name: string;
  @ApiProperty({ description: 'ID de la tabla maestra payment_methods de NextPyme' }) nextpymeMethodId: number;
}
