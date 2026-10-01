import { Controller, Get, Put, Delete, Param, ParseEnumPipe, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntegrationProvider } from './enums/integration-provider.enum';
import { IntegrationLogoService, MAX_LOGO_BYTES } from './integration-logo.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import { IntegrationProvidersResponseDto } from './dto/integration-providers.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService, private readonly logos: IntegrationLogoService) {}

  @Get(':provider/logo')
  getLogo(@CurrentUser() user: AuthenticatedUser, @Param('provider', new ParseEnumPipe(IntegrationProvider)) provider: IntegrationProvider) {
    return this.logos.get(getAuthenticatedCompanyId(user), provider);
  }

  @Put(':provider/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES, files: 1 } }))
  saveLogo(@CurrentUser() user: AuthenticatedUser, @Param('provider', new ParseEnumPipe(IntegrationProvider)) provider: IntegrationProvider, @UploadedFile() file?: Express.Multer.File) {
    return this.logos.save(getAuthenticatedCompanyId(user), provider, file);
  }

  @Delete(':provider/logo')
  removeLogo(@CurrentUser() user: AuthenticatedUser, @Param('provider', new ParseEnumPipe(IntegrationProvider)) provider: IntegrationProvider) {
    return this.logos.remove(getAuthenticatedCompanyId(user), provider);
  }

  @Get('providers')
  @ApiOperation({
    summary: 'Proveedores activos de la empresa',
    description:
      'Lista los proveedores de integración activos (SIIGO, JARVIS) de la empresa del JWT.',
  })
  getActiveProviders(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IntegrationProvidersResponseDto> {
    return this.integrationsService.getActiveProviders(
      getAuthenticatedCompanyId(user),
    );
  }
}
