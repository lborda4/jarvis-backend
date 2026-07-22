import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import { JarvisCredentialsStatusResponseDto } from './dto/jarvis-credentials-status.dto';
import {
  SaveJarvisCredentialsRequestDto,
  SaveJarvisCredentialsResponseDto,
} from './dto/save-jarvis-credentials.dto';
import { JarvisSetupService } from './jarvis-setup.service';

@ApiTags('integrations/jarvis')
@Controller('integrations/jarvis')
export class JarvisController {
  constructor(private readonly jarvisSetupService: JarvisSetupService) {}

  @Post('credentials')
  @ApiOperation({
    summary: 'Guardar configuración inicial Jarvis',
    description:
      'Persiste razón social, actividad económica, tipo de contribuyente y régimen en integrations.credentials.',
  })
  saveCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: SaveJarvisCredentialsRequestDto,
  ): Promise<SaveJarvisCredentialsResponseDto> {
    return this.jarvisSetupService.saveCredentials(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('credentials/status')
  @ApiOperation({
    summary: 'Estado de configuración Jarvis',
    description:
      'Indica si la empresa activa ya completó la configuración inicial de Jarvis.',
  })
  getCredentialsStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JarvisCredentialsStatusResponseDto> {
    return this.jarvisSetupService.getCredentialsStatus(
      getAuthenticatedCompanyId(user),
    );
  }
}
