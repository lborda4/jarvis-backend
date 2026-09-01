import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { AdminService } from './admin.service';
import {
  CreateAdminCompanyRequestDto,
  CreateAdminCompanyResponseDto,
  ListAdminCitiesResponseDto,
  ListAdminCompaniesResponseDto,
  ListAdminPlansResponseDto,
  LookupAdminCompanyNameResponseDto,
  RegenerateCompanyInviteCodeResponseDto,
  UpdateCompanyCityRequestDto,
  UpdateCompanyCityResponseDto,
  UpdateCompanyNextPymeTokenRequestDto,
  UpdateCompanyNextPymeTokenResponseDto,
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

  @Get('cities')
  @ApiOperation({
    summary: 'Listar ciudades (catálogo DANE)',
    description:
      'Catálogo de municipios (código DANE + nombre) para elegir la ciudad de una empresa.',
  })
  listCities(): Promise<ListAdminCitiesResponseDto> {
    return this.adminService.listCities();
  }

  @Get('companies/lookup-name')
  @ApiOperation({
    summary: 'Buscar razón social por NIT (RUT/RUES)',
    description:
      'Consulta el RUT/RUES de la DIAN por NIT para precargar el campo "Nombre" al crear una empresa, sin necesidad de subir el PDF del RUT.',
  })
  lookupCompanyName(
    @Query('nit') nit: string,
  ): Promise<LookupAdminCompanyNameResponseDto> {
    return this.adminService.lookupCompanyName(nit ?? '');
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

  @Post('companies/:companyId/invite-code/regenerate')
  @ApiOperation({
    summary: 'Regenerar código de invitación',
    description:
      'Genera un nuevo código de invitación para la empresa (invalida el anterior). Úsalo si el código se filtró o quieres rotarlo.',
  })
  regenerateInviteCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('companyId') companyId: string,
  ): Promise<RegenerateCompanyInviteCodeResponseDto> {
    return this.adminService.regenerateInviteCode(companyId, user.userId);
  }

  @Patch('companies/:companyId/nextpyme-token')
  @ApiOperation({
    summary: 'Configurar token de NextPyme de la empresa',
    description:
      'Guarda el token Bearer propio de NextPyme para esta empresa (usado al consultar factura de compra por CUFE). Vacío/null para volver a usar el token global.',
  })
  updateNextPymeToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('companyId') companyId: string,
    @Body() request: UpdateCompanyNextPymeTokenRequestDto,
  ): Promise<UpdateCompanyNextPymeTokenResponseDto> {
    return this.adminService.updateNextPymeToken(
      companyId,
      request,
      user.userId,
    );
  }

  @Patch('companies/:companyId/city')
  @ApiOperation({
    summary: 'Configurar ciudad de la empresa',
    description:
      'Guarda la ciudad (código DANE) de esta empresa. Se usa como default de ciudad al crear un tercero en SIIGO cuando el proveedor no trae dirección propia.',
  })
  updateCompanyCity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('companyId') companyId: string,
    @Body() request: UpdateCompanyCityRequestDto,
  ): Promise<UpdateCompanyCityResponseDto> {
    return this.adminService.updateCompanyCity(companyId, request, user.userId);
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
