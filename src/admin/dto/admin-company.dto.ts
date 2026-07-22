import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IntegrationProvider } from '../../integration/enums/integration-provider.enum';

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

  @ApiPropertyOptional({ nullable: true })
  documentLimit: number | null;
}

export class AdminIntegrationItemDto {
  @ApiProperty({ enum: IntegrationProvider })
  provider: IntegrationProvider;

  @ApiProperty()
  active: boolean;
}

export class AdminCompanyListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  nit: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ type: AdminCompanyResponsibleDto, nullable: true })
  responsible: AdminCompanyResponsibleDto | null;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional({ type: AdminPlanDto, nullable: true })
  companyPlan: AdminPlanDto | null;

  @ApiProperty({ type: [AdminIntegrationItemDto] })
  integrations: AdminIntegrationItemDto[];
}

export class CreateAdminCompanyRequestDto {
  @ApiProperty({ example: '900123456' })
  nit: string;

  @ApiProperty({ example: 'Empresa Demo SAS' })
  name: string;

  @ApiProperty({ type: AdminCompanyResponsibleDto })
  responsible: AdminCompanyResponsibleDto;

  @ApiProperty({
    enum: IntegrationProvider,
    isArray: true,
    example: [IntegrationProvider.SIIGO, IntegrationProvider.JARVIS],
  })
  integrations: IntegrationProvider[];

  @ApiProperty({
    example: '11111111-1111-4111-8111-111111111102',
    description: 'Plan asignado a la empresa.',
  })
  companyPlanId: string;
}

export class CreateAdminCompanyResponseDto {
  @ApiProperty({ type: AdminCompanyListItemDto })
  company: AdminCompanyListItemDto;
}

export class ListAdminCompaniesResponseDto {
  @ApiProperty({ type: [AdminCompanyListItemDto] })
  items: AdminCompanyListItemDto[];
}

export class ListAdminPlansResponseDto {
  @ApiProperty({ type: [AdminPlanDto] })
  items: AdminPlanDto[];
}
