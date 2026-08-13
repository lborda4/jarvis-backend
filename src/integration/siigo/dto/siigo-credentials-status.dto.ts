import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ElectronicDocumentType } from '../../../electronic-document/enums/electronic-document-type.enum';
import { SubscriptionStatus } from '../../../plan/enums/subscription-status.enum';

export class SiigoSubscriptionPlanDto {
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

export class SiigoSubscriptionStatusDto {
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

  @ApiPropertyOptional({ type: SiigoSubscriptionPlanDto, nullable: true })
  plan: SiigoSubscriptionPlanDto | null;
}

export class SiigoCredentialsStatusResponseDto {
  @ApiProperty({
    description:
      'Indica si la empresa activa ya tiene credenciales SIIGO guardadas.',
  })
  configured: boolean;

  @ApiProperty({
    description:
      'Indica si la empresa ya sincronizó cuentas contables desde SIIGO (siigo_accounts).',
  })
  hasAccounts: boolean;

  @ApiProperty({
    description:
      'Indica si ya se configuraron los comprobantes de cargue requeridos por el plan (DS/FC).',
  })
  documentTypesConfigured: boolean;

  @ApiProperty({ type: SiigoSubscriptionStatusDto })
  subscription: SiigoSubscriptionStatusDto;

  @ApiPropertyOptional({
    example: 'asesorias@j2s-soluciones.com',
    description: 'Usuario SIIGO configurado para la empresa activa.',
  })
  username?: string;

  @ApiPropertyOptional({
    example: 'harvis',
    description: 'Partner ID configurado para la empresa activa.',
  })
  partner_id?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Comprobante DS seleccionado para Documento soporte.',
  })
  supportDocumentTypeId?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Comprobante FC seleccionado para Factura de compra.',
  })
  purchaseInvoiceTypeId?: number | null;
}
