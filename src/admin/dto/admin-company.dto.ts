import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CompanyPersonType } from '../../company/enums/company-person-type.enum';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { IntegrationProvider } from '../../integration/enums/integration-provider.enum';
import { JarvisCredentialsSeedDto } from '../../integration/jarvis/dto/jarvis-credentials-seed.dto';
import { SubscriptionStatus } from '../../plan/enums/subscription-status.enum';

export { JarvisCredentialsSeedDto };

export class AdminCompanyResponsibleDto {
  @ApiProperty({ example: 'María García' })
  name: string;

  @ApiProperty({ example: '3001234567' })
  phone: string;

  @ApiProperty({ example: 'maria.garcia@empresa.com' })
  email: string;
}

export class AdminPlanDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ enum: IntegrationProvider })
  provider: IntegrationProvider;

  @ApiPropertyOptional({ nullable: true })
  documentLimit: number | null;

  @ApiProperty({
    enum: ElectronicDocumentType,
    isArray: true,
    example: [ElectronicDocumentType.SUPPORT_DOCUMENT],
  })
  includedDocumentTypes: ElectronicDocumentType[];
}

export class AdminIntegrationItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: IntegrationProvider })
  provider: IntegrationProvider;

  @ApiProperty()
  active: boolean;

  @ApiPropertyOptional({ enum: SubscriptionStatus, nullable: true })
  subscriptionStatus: SubscriptionStatus | null;

  @ApiPropertyOptional({ nullable: true })
  subscriptionStartedAt: string | null;

  @ApiProperty({
    enum: ElectronicDocumentType,
    isArray: true,
    example: [ElectronicDocumentType.SUPPORT_DOCUMENT],
  })
  includedDocumentTypes: ElectronicDocumentType[];

  @ApiPropertyOptional({ type: AdminPlanDto, nullable: true })
  plan: AdminPlanDto | null;
}

export class AdminCompanyListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  nit: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ enum: CompanyPersonType, nullable: true })
  personType: CompanyPersonType | null;

  @ApiPropertyOptional({ type: AdminCompanyResponsibleDto, nullable: true })
  responsible: AdminCompanyResponsibleDto | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty({
    description:
      'Código que deben ingresar los nuevos usuarios junto con el NIT para vincularse a esta empresa.',
    example: 'AB3DEFGH2K',
  })
  inviteCode: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Token Bearer propio de la empresa para NextPyme. Si es null, la consulta de factura de compra por CUFE usa el token global (NEXTPYME_API_TOKEN).',
  })
  nextPymeToken: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Código DANE de la ciudad de la empresa. Se usa como default de ciudad al crear un tercero en SIIGO cuando el proveedor no trae dirección propia.',
    example: '11001',
  })
  cityCode: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Bogotá, D.C.' })
  cityName: string | null;

  @ApiProperty({ type: [AdminIntegrationItemDto] })
  integrations: AdminIntegrationItemDto[];
}

export class CreateAdminCompanyRequestDto {
  @ApiProperty({ example: '900123456' })
  nit: string;

  @ApiProperty({ example: 'Empresa Demo SAS' })
  name: string;

  @ApiProperty({
    enum: CompanyPersonType,
    description: 'Tipo de contribuyente según el RUT.',
  })
  personType: CompanyPersonType;

  @ApiPropertyOptional({
    type: AdminCompanyResponsibleDto,
    description: 'Persona a cargo (opcional).',
  })
  responsible?: AdminCompanyResponsibleDto;

  @ApiProperty({
    enum: IntegrationProvider,
    isArray: true,
    example: [IntegrationProvider.SIIGO, IntegrationProvider.JARVIS],
  })
  integrations: IntegrationProvider[];

  @ApiProperty({
    example: '11111111-1111-4111-8111-111111111102',
    description:
      'Plan asignado a la integración SIIGO (requerido si SIIGO está seleccionado).',
  })
  siigoPlanId?: string;

  @ApiPropertyOptional({
    example: '21111111-1111-4111-8111-111111111102',
    description:
      'Plan asignado a la integración Jarvis (requerido si Jarvis está seleccionado).',
  })
  jarvisPlanId?: string;

  @ApiPropertyOptional({
    enum: ElectronicDocumentType,
    isArray: true,
    example: [ElectronicDocumentType.SUPPORT_DOCUMENT],
    description:
      'Tipos de documento habilitados. Si se omite, se usan los del plan.',
  })
  includedDocumentTypes?: ElectronicDocumentType[];

  @ApiPropertyOptional({
    type: JarvisCredentialsSeedDto,
    description:
      'Datos tributarios extraídos del RUT para prellenar la configuración Jarvis.',
  })
  jarvisCredentials?: JarvisCredentialsSeedDto;

  @ApiPropertyOptional({
    description: 'Código DANE de la ciudad de la empresa.',
    example: '11001',
  })
  cityCode?: string;

  @ApiPropertyOptional({ example: 'Bogotá, D.C.' })
  cityName?: string;

  @ApiPropertyOptional({
    description:
      'Token Bearer propio de la empresa para NextPyme. Si se omite, la consulta de factura de compra por CUFE usa el token global (NEXTPYME_API_TOKEN).',
  })
  nextPymeToken?: string;
}

export class UpdateIntegrationSubscriptionRequestDto {
  @ApiPropertyOptional({
    example: '11111111-1111-4111-8111-111111111102',
    description: 'Nuevo plan para la integración.',
  })
  planId?: string;

  @ApiPropertyOptional({
    enum: SubscriptionStatus,
    description: 'ACTIVE habilita servicios; SUSPENDED/CANCELLED los quita.',
  })
  subscriptionStatus?: SubscriptionStatus;

  @ApiPropertyOptional({
    enum: ElectronicDocumentType,
    isArray: true,
    description: 'Tipos de documento habilitados para esta integración.',
  })
  includedDocumentTypes?: ElectronicDocumentType[];

  @ApiPropertyOptional({
    description:
      'Si es true, reinicia la fecha de inicio de suscripción al asignar plan.',
  })
  restartSubscription?: boolean;
}

export class CreateAdminCompanyResponseDto {
  @ApiProperty({ type: AdminCompanyListItemDto })
  company: AdminCompanyListItemDto;
}

export class UpdateIntegrationSubscriptionResponseDto {
  @ApiProperty({ type: AdminIntegrationItemDto })
  integration: AdminIntegrationItemDto;
}

export class ListAdminCompaniesResponseDto {
  @ApiProperty({ type: [AdminCompanyListItemDto] })
  items: AdminCompanyListItemDto[];
}

export class ListAdminPlansResponseDto {
  @ApiProperty({ type: [AdminPlanDto] })
  items: AdminPlanDto[];
}

export class RegenerateCompanyInviteCodeResponseDto {
  @ApiProperty({ type: AdminCompanyListItemDto })
  company: AdminCompanyListItemDto;
}

export class UpdateCompanyNextPymeTokenRequestDto {
  @ApiProperty({
    description:
      'Token Bearer de NextPyme para esta empresa. Enviar vacío/null para volver a usar el token global.',
    example: 'e7f162aab2e81ec13840102d744c31eb6504f5d7a94cc8ca5709acdcaef16c30',
  })
  nextPymeToken: string | null;
}

export class UpdateCompanyNextPymeTokenResponseDto {
  @ApiProperty({ type: AdminCompanyListItemDto })
  company: AdminCompanyListItemDto;
}

export class UpdateCompanyCityRequestDto {
  @ApiPropertyOptional({
    description:
      'Código DANE de la ciudad. Enviar vacío/null para quitar la ciudad configurada.',
    example: '11001',
    nullable: true,
  })
  cityCode: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Bogotá, D.C.' })
  cityName: string | null;
}

export class UpdateCompanyCityResponseDto {
  @ApiProperty({ type: AdminCompanyListItemDto })
  company: AdminCompanyListItemDto;
}

export class AdminCityOptionDto {
  @ApiProperty({ description: 'Código DANE de la ciudad.', example: '11001' })
  code: string;

  @ApiProperty({ example: 'Bogotá, D.C.' })
  name: string;
}

export class ListAdminCitiesResponseDto {
  @ApiProperty({ type: [AdminCityOptionDto] })
  items: AdminCityOptionDto[];
}

export class LookupAdminCompanyNameResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    example: 'Empresa Ejemplo SAS',
    description:
      'Razón social encontrada en el RUT/RUES de la DIAN. Null si no se encontró.',
  })
  name: string | null;
}
