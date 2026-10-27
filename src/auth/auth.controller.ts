import {
  Param,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ParseRutResponseDto, ParseRutUploadDto } from '../admin/dto/parse-rut.dto';
import { RutParserService } from '../admin/rut-parser.service';
import { AuthService } from './auth.service';
import {
  FORGOT_PASSWORD_MESSAGE,
  RESET_PASSWORD_SUCCESS_MESSAGE,
} from './constants/password-reset.constants';
import { resolveClientIp } from './helpers/password-reset.helper';
import { PasswordResetService } from './services/password-reset.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  AuthMeResponseDto,
  AuthTokensResponseDto,
  ForgotPasswordRequestDto,
  LoginRequestDto,
  PasswordResetMessageDto,
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
  RegisterRequestDto,
  ResetPasswordRequestDto,
  SwitchCompanyRequestDto,
} from './dto/auth.dto';
import type { AuthenticatedUser } from './interfaces/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Get('integration-policy/:policyId')
  getPolicyAcceptance(@CurrentUser() user: AuthenticatedUser, @Param('policyId') policyId: string) {
    return this.authService.integrationPolicyAcceptance(user.userId, user.companyId, policyId);
  }

  @Post('integration-policy/:policyId/accept')
  acceptPolicy(@CurrentUser() user: AuthenticatedUser, @Param('policyId') policyId: string) {
    return this.authService.integrationPolicyAcceptance(user.userId, user.companyId, policyId, true);
  }

  constructor(
    private readonly authService: AuthService,
    private readonly rutParserService: RutParserService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Public()
  @Post('rut/parse')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ParseRutUploadDto })
  @ApiOperation({
    summary: 'Extraer datos del RUT durante el registro',
  })
  async parseRut(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ParseRutResponseDto> {
    return {
      data: await this.rutParserService.parse(file),
    };
  }

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Registrar usuario y vincularlo a una empresa existente por NIT',
  })
  register(
    @Body() request: RegisterRequestDto,
  ): Promise<AuthTokensResponseDto> {
    return this.authService.register(request);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Iniciar sesión' })
  login(@Body() request: LoginRequestDto): Promise<AuthTokensResponseDto> {
    return this.authService.login(request);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Renovar access token' })
  refresh(
    @Body() request: RefreshTokenRequestDto,
  ): Promise<RefreshTokenResponseDto> {
    return this.authService.refresh(request);
  }

  @Get('me')
  @ApiOperation({ summary: 'Obtener usuario y empresa activa desde el JWT' })
  getMe(@CurrentUser() currentUser: AuthenticatedUser): Promise<AuthMeResponseDto> {
    return this.authService.getMe(currentUser);
  }

  @Post('switch-company')
  @ApiOperation({ summary: 'Cambiar la empresa activa del usuario autenticado' })
  switchCompany(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() request: SwitchCompanyRequestDto,
  ): Promise<AuthTokensResponseDto> {
    return this.authService.switchCompany(currentUser, request);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Solicitar un enlace para restablecer la contraseña',
  })
  async forgotPassword(
    @Body() request: ForgotPasswordRequestDto,
    @Req() req: Request,
  ): Promise<PasswordResetMessageDto> {
    await this.passwordResetService.requestReset(request?.email, resolveClientIp(req));
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Restablecer la contraseña con el enlace recibido' })
  async resetPassword(
    @Body() request: ResetPasswordRequestDto,
  ): Promise<PasswordResetMessageDto> {
    await this.passwordResetService.resetPassword(request?.token, request?.password);
    return { message: RESET_PASSWORD_SUCCESS_MESSAGE };
  }
}
