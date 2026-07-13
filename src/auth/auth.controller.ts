import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
} from './dto/auth.dto';
import type { AuthenticatedUser } from './interfaces/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
