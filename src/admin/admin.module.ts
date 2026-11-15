import { AdminPayrollNumberingController } from './admin-payroll-numbering.controller';
import { AdminPayrollNumberingService } from './admin-payroll-numbering.service';
import { AdminBillingEnvironmentController } from './admin-billing-environment.controller';
import { AdminBillingEnvironmentService } from './admin-billing-environment.service';
import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyModule } from '../company/company.module';
import { IntegrationModule } from '../integration/integration.module';
import { JarvisModule } from '../integration/jarvis/jarvis.module';
import { PlanModule } from '../plan/plan.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';
import { RutParserService } from './rut-parser.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    CompanyModule,
    forwardRef(() => IntegrationModule),
    forwardRef(() => JarvisModule),
    forwardRef(() => PlanModule),
  ],
  controllers: [AdminController, AdminBillingEnvironmentController, AdminPayrollNumberingController],
  providers: [AdminService, AdminGuard, RutParserService, AdminBillingEnvironmentService, AdminPayrollNumberingService],
})
export class AdminModule {}
