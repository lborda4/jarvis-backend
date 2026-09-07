import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoldCashRegistersService } from './bold-cash-registers.service';
import { BoldController } from './bold.controller';
import { BoldPaymentsService } from './bold-payments.service';
import { BoldTerminalsService } from './bold-terminals.service';
import { BoldHttpClient } from './clients/bold-http.client';
import { SiigoBoldCashRegister } from './entities/siigo-bold-cash-register.entity';
import { SiigoBoldCashRegistersRepository } from './repositories/siigo-bold-cash-registers.repository';

@Module({
  // AuthModule: AdminGuard (usado en GET /bold/payments/binded-terminals y en
  // los endpoints de cash-registers) depende de UsersRepository para validar
  // el rol admin.
  imports: [
    HttpModule,
    AuthModule,
    TypeOrmModule.forFeature([SiigoBoldCashRegister]),
  ],
  controllers: [BoldController],
  providers: [
    BoldPaymentsService,
    BoldTerminalsService,
    BoldCashRegistersService,
    BoldHttpClient,
    SiigoBoldCashRegistersRepository,
  ],
  exports: [SiigoBoldCashRegistersRepository],
})
export class BoldModule {}
