import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserCompany } from './entities/user-company.entity';
import { User } from './entities/user.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserCompaniesRepository } from './repositories/user-companies.repository';
import { UsersRepository } from './repositories/users.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthenticatedUserResolverService } from './services/authenticated-user-resolver.service';
import { WsAuthService } from './services/ws-auth.service';
import { AppConfiguration } from '../config/configuration';
import { RutParserService } from '../admin/rut-parser.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserCompany]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfiguration, true>) => ({
        secret: configService.get('jwt.accessSecret', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    UserCompaniesRepository,
    RutParserService,
    JwtStrategy,
    AuthenticatedUserResolverService,
    WsAuthService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [
    AuthService,
    UsersRepository,
    UserCompaniesRepository,
    JwtModule,
    AuthenticatedUserResolverService,
    WsAuthService,
  ],
})
export class AuthModule {}
