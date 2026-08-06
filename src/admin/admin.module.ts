import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyModule } from '../company/company.module';
import { IntegrationModule } from '../integration/integration.module';
import { PlanModule } from '../plan/plan.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';
import { RutParserService } from './rut-parser.service';

@Module({
  imports: [AuthModule, CompanyModule, IntegrationModule, PlanModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, RutParserService],
})
export class AdminModule {}
