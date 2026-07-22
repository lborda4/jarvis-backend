import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyModule } from '../company/company.module';
import { PlanModule } from '../plan/plan.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';

@Module({
  imports: [AuthModule, CompanyModule, PlanModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
