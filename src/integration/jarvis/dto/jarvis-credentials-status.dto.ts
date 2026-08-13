import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ElectronicDocumentType } from '../../../electronic-document/enums/electronic-document-type.enum';
import { SubscriptionStatus } from '../../../plan/enums/subscription-status.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../enums/jarvis-vat-regime.enum';
import { JarvisResolutionDto } from './jarvis-resolution.dto';

export class JarvisSubscriptionPlanDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  code: string;

  @ApiPropertyOptional({ nullable: true })
  documentLimit: number | null;

  @ApiProperty({
    enum: ElectronicDocumentType,
    isArray: true,
  })
  includedDocumentTypes: ElectronicDocumentType[];
}

export class JarvisSubscriptionStatusDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus, nullable: true })
  status: SubscriptionStatus | null;

  @ApiPropertyOptional({ nullable: true })
  startedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  documentLimit: number | null;

  @ApiProperty()
  documentsUsed: number;

  @ApiPropertyOptional({ nullable: true })
  remaining: number | null;

  @ApiProperty({
    enum: ElectronicDocumentType,
    isArray: true,
  })
  includedDocumentTypes: ElectronicDocumentType[];

  @ApiPropertyOptional({ type: JarvisSubscriptionPlanDto, nullable: true })
  plan: JarvisSubscriptionPlanDto | null;
}

export class JarvisCredentialsStatusResponseDto {
  @ApiProperty({
    description:
      'Indica si la empresa activa ya completó la configuración inicial de Jarvis.',
  })
  configured: boolean;

  @ApiProperty({ type: JarvisSubscriptionStatusDto })
  subscription: JarvisSubscriptionStatusDto;

  @ApiPropertyOptional({ example: 'J2S Soluciones SAS' })
  business_name?: string;

  @ApiPropertyOptional({ example: 'J2S' })
  trade_name?: string;

  @ApiPropertyOptional({
    example: 'Consultoría en tecnologías de la información',
  })
  economic_activity?: string;

  @ApiPropertyOptional({ enum: JarvisTaxRegime })
  tax_regime?: JarvisTaxRegime;

  @ApiPropertyOptional({ enum: JarvisVatRegime })
  vat_regime?: JarvisVatRegime;

  @ApiPropertyOptional({ enum: JarvisTaxResponsibility })
  tax_responsibility?: JarvisTaxResponsibility;

  @ApiPropertyOptional({ example: 'Colombia' })
  country?: string;

  @ApiPropertyOptional({ example: 'Cundinamarca' })
  department?: string;

  @ApiPropertyOptional({ example: 'Bogotá D.C.' })
  municipality?: string;

  @ApiPropertyOptional({ example: 'Bogotá' })
  city?: string;

  @ApiPropertyOptional({ example: 'contacto@empresa.com' })
  email?: string;

  @ApiPropertyOptional({ example: 'Calle 100 #10-20' })
  address?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  phone?: string;

  @ApiPropertyOptional({ example: '2026-07-20T12:00:00.000Z' })
  configured_at?: string;

  @ApiPropertyOptional({ type: JarvisResolutionDto, nullable: true })
  supportDocumentResolution?: JarvisResolutionDto | null;

  @ApiPropertyOptional({ type: JarvisResolutionDto, nullable: true })
  electronicInvoiceResolution?: JarvisResolutionDto | null;

  @ApiProperty({
    description:
      'Indica si la resolución de documento soporte ya está configurada.',
  })
  supportDocumentResolutionConfigured: boolean;

  @ApiProperty({
    description:
      'Indica si la resolución de factura electrónica ya está configurada.',
  })
  electronicInvoiceResolutionConfigured: boolean;
}
