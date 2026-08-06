import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { AdminService } from './admin.service';
import {
  CreateAdminCompanyRequestDto,
  CreateAdminCompanyResponseDto,
  ListAdminCompaniesResponseDto,
  ListAdminPlansResponseDto,
  UpdateIntegrationSubscriptionRequestDto,
  UpdateIntegrationSubscriptionResponseDto,
} from './dto/admin-company.dto';
import { ParseRutResponseDto, ParseRutUploadDto } from './dto/parse-rut.dto';
import { AdminGuard } from './guards/admin.guard';
import { RutParserService } from './rut-parser.service';

@ApiTags('admin')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly rutParserService: RutParserService,
  ) {}

  @Get('plans')
  @ApiOperation({
    summary: 'Listar planes',
    description:
      'Lista los planes disponibles por integración (documentos incluidos y límites).',
  })
  listPlans(): Promise<ListAdminPlansResponseDto> {
    return this.adminService.listPlans();
  }

  @Get('companies')
  @ApiOperation({
    summary: 'Listar empresas',
    description:
      'Panel interno de administración. Lista empresas con suscripciones por integración.',
  })
  listCompanies(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListAdminCompaniesResponseDto> {
    return this.adminService.listCompanies(user.userId);
  }

  @Post('companies/rut/parse')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ParseRutUploadDto })
  @ApiOperation({
    summary: 'Extraer datos de un RUT',
    description:
      'Lee un PDF del RUT de la DIAN y devuelve datos para revisar antes de crear una empresa.',
  })
  async parseRut(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ParseRutResponseDto> {
    return {
      data: await this.rutParserService.parse(file),
    };
  }

  @Post('companies')
  @ApiOperation({
    summary: 'Crear empresa',
    description:
      'Crea una empresa por NIT, configura integraciones y asigna plan SIIGO/Jarvis si aplica.',
  })
  createCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateAdminCompanyRequestDto,
  ): Promise<CreateAdminCompanyResponseDto> {
    return this.adminService.createCompany(request, user.userId);
  }

  @Patch('companies/:companyId/integrations/:provider/subscription')
  @ApiOperation({
    summary: 'Actualizar suscripción de integración',
    description:
      'Cambia el plan o el estado (ACTIVE/SUSPENDED/CANCELLED) para habilitar o quitar servicios.',
  })
  updateIntegrationSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('companyId') companyId: string,
    @Param('provider', new ParseEnumPipe(IntegrationProvider))
    provider: IntegrationProvider,
    @Body() request: UpdateIntegrationSubscriptionRequestDto,
  ): Promise<UpdateIntegrationSubscriptionResponseDto> {
    return this.adminService.updateIntegrationSubscription(
      companyId,
      provider,
      request,
      user.userId,
    );
  }
}
