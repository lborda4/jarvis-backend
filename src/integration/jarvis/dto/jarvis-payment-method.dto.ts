import { ApiProperty } from '@nestjs/swagger';

export class SaveJarvisPaymentMethodDto {
  @ApiProperty({ enum: ['CASH', 'CREDIT'], required: false }) negotiation?: 'CASH' | 'CREDIT';
  @ApiProperty({ example: 'Transferencia Bancolombia', maxLength: 120 }) name: string;
  @ApiProperty({ description: 'ID de la tabla maestra payment_methods de NextPyme' }) nextpymeMethodId: number;
}
