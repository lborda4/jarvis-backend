import { BadRequestException } from '@nestjs/common';
import { IntegrationProvider } from '../enums/integration-provider.enum';

export function parseDocumentProvider(value?: string): IntegrationProvider | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === IntegrationProvider.SIIGO || value === IntegrationProvider.JARVIS) return value;
  throw new BadRequestException('La integración debe ser SIIGO o JARVIS.');
}
