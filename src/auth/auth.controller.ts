import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
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
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  AuthMeResponseDto,
  AuthTokensResponseDto,
  LoginRequestDto,
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
  RegisterRequestDto,
  SwitchCompanyRequestDto,
} from './dto/auth.dto';
import type { AuthenticatedUser } from './interfaces/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rutParserService: RutParserService,
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
  @ApiOperation({ summary: 'Registrar usuario y empresa' })
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
}
