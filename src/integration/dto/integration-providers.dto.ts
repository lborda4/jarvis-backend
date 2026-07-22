import { ApiProperty } from '@nestjs/swagger';
import { IntegrationProvider } from '../enums/integration-provider.enum';

export class IntegrationProvidersResponseDto {
  @ApiProperty({
    type: [String],
    enum: IntegrationProvider,
    example: [IntegrationProvider.JARVIS],
    description:
      'Proveedores de integración activos configurados para la empresa.',
  })
  providers: IntegrationProvider[];
}
