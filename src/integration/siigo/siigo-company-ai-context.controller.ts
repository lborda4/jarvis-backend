import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Put,
  forwardRef,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import {
  readCompanyAiContext,
  validateCompanyAiContext,
} from '../../company/company-ai-context';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { IntegrationProvider } from '../enums/integration-provider.enum';
export class CompanyAiContextRequest {
  @ApiProperty({ maxLength: 1000 })
  description: string;
  @ApiProperty({ type: [String], maxItems: 10 })
  rules: string[];
  @ApiProperty({
    type: [String],
    required: false,
    maxItems: 100,
    description:
      'Nombres, expresiones o codigos excluidos del catalogo para la IA.',
  })
  blockedAccounts?: string[];
}
@ApiTags('integrations/siigo')
@Controller('integrations/siigo/company-ai-context')
export class SiigoCompanyAiContextController {
  constructor(
    private readonly companies: CompaniesRepository,
    @Inject(forwardRef(() => PlanSubscriptionService))
    private readonly subscriptions: PlanSubscriptionService,
  ) {}
  private async requireCompany(user: AuthenticatedUser) {
    const companyId = getAuthenticatedCompanyId(user);
    const subscription = await this.subscriptions.getSubscription(
      companyId,
      IntegrationProvider.SIIGO,
    );
    if (
      !subscription.includedDocumentTypes.includes(
        ElectronicDocumentType.PURCHASE_INVOICE,
      )
    )
      throw new ForbiddenException(
        'Esta configuración requiere Factura de compra en la integración SIIGO.',
      );
    const company = await this.companies.findById(companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada.');
    return company;
  }
  @Get()
  async get(@CurrentUser() user: AuthenticatedUser) {
    return readCompanyAiContext((await this.requireCompany(user)).description);
  }
  @Put()
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CompanyAiContextRequest,
  ) {
    const company = await this.requireCompany(user);
    company.description = validateCompanyAiContext(request);
    await this.companies.save(company);
    return company.description;
  }
}
